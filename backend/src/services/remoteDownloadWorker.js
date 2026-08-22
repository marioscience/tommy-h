import fsPromises from 'fs/promises';
import path from 'path';
import http from 'http';
import https from 'https';
import util from 'util';
import net from 'net';
import dns from 'dns/promises';
import { query } from '../db.js';
import { rustUtil } from '../utils/rustUtil.js';
import { PLAN_LIMITS } from '../config.js';

export const activeDownloads = new Map();
export const storageCache = new Map();
const DOWNLOAD_RETRY_LIMIT = Math.max(1, Number(process.env.DOWNLOAD_RETRY_LIMIT || 2));
const DOWNLOAD_JOB_RETENTION_MS = Math.max(60000, Number(process.env.DOWNLOAD_JOB_RETENTION_MS || 10 * 60 * 1000));
const configuredRemoteMaxBytes = Number(process.env.REMOTE_DOWNLOAD_MAX_BYTES);
export const REMOTE_DOWNLOAD_MAX_BYTES = Number.isSafeInteger(configuredRemoteMaxBytes) && configuredRemoteMaxBytes >= 1024 * 1024
    ? configuredRemoteMaxBytes
    : 10 * 1024 * 1024 * 1024;
const REMOTE_REDIRECT_LIMIT = 5;
let downloadWorkerStarted = false;
let downloadWorkerBusy = false;

export const getSafePath = (base, target) => {
    const resolvedBase = path.resolve(base);
    const cleanTarget = (target || '').replace(/^/+/, '');
    const resolvedTarget = path.resolve(resolvedBase, cleanTarget || '.');

    if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
        throw new Error("Acceso denegado: Intento de Path Traversal detectado.");
    }
    return resolvedTarget;
};

export const isVaultProtected = (reqPath) => {
    if (!reqPath || !reqPath.includes('[market]')) return false;
    const fileName = path.basename(reqPath).toLowerCase();
    const ext = path.extname(reqPath).toLowerCase();
    const allowedLuaFiles = ['config.lua', 'shared.lua', 'fxmanifest.lua'];
    return ext === '.lua' && !allowedLuaFiles.includes(fileName);
};

export async function getStorageAllowance(row, forceRefresh = false) {
    const now = Date.now();
    const cached = storageCache.get(row.id);
    let usedBytes;

    if (!forceRefresh && cached && (now - cached.timestamp < 15000)) {
        usedBytes = cached.size;
    } else {
        usedBytes = await rustUtil.getDirSize(row.data_path);
        storageCache.set(row.id, { size: usedBytes, timestamp: now });
    }

    const plan = PLAN_LIMITS[row.runtime_plan] || PLAN_LIMITS.hobby;
    const maxBytes = Number(plan?.diskBytes || PLAN_LIMITS.hobby.diskBytes) + ((row.extra_disk_gb || 0) * 1024 ** 3);
    return { usedBytes, maxBytes, remainingBytes: Math.max(0, maxBytes - usedBytes) };
}

export async function checkStorageLimit(row, incomingBytes = 0, forceRefresh = false) {
    const { usedBytes, maxBytes } = await getStorageAllowance(row, forceRefresh);
    if ((usedBytes + incomingBytes) > maxBytes) {
        throw new Error(`Has alcanzado el limite de almacenamiento de tu plan (${maxBytes / (1024**3)} GB). Borra archivos o mejora tu plan.`);
    }
    return true;
}

export function isForbiddenRemoteAddress(address) {
    const normalized = String(address || '').toLowerCase().split('%')[0];
    if (net.isIP(normalized) === 4) {
        const [a, b] = normalized.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 || a >= 224
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 198 && (b === 18 || b === 19));
    }
    if (net.isIP(normalized) === 6) {
        if (normalized.startsWith('::ffff:')) return isForbiddenRemoteAddress(normalized.slice(7));
        return normalized === '::1'
            || normalized.startsWith('fe80:')
            || normalized.startsWith('fc')
            || normalized.startsWith('fd');
    }
    return true;
}

export async function validateRemoteTargetUrl(rawUrl) {
    let parsed;
    try { parsed = new URL(rawUrl); } catch { throw new Error('URL remota invalida.'); }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Solo se permiten descargas HTTP y HTTPS.');
    }

    const hostname = parsed.hostname;
    if (!hostname) throw new Error('Host vacio en la URL remota.');

    const ipType = net.isIP(hostname);
    if (ipType !== 0) {
        if (isForbiddenRemoteAddress(hostname)) throw new Error('La direccion IP remota solicitada no esta permitida.');
        return { parsedUrl: parsed, resolvedIp: hostname };
    }

    const addresses = await dns.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) throw new Error('No se pudo resolver el host remoto.');

    for (const item of addresses) {
        if (isForbiddenRemoteAddress(item.address)) {
            throw new Error(`El host ${hostname} resuelve a una IP de red privada deshabilitada (${item.address}).`);
        }
    }
    return { parsedUrl: parsed, resolvedIp: addresses[0].address };
}

export async function ensureDownloadJobsTable() {
    await query(`
        CREATE TABLE IF NOT EXISTS download_jobs (
            id TEXT PRIMARY KEY,
            server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            url TEXT NOT NULL,
            target_path TEXT NOT NULL,
            file_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            bytes_downloaded BIGINT NOT NULL DEFAULT 0,
            total_bytes BIGINT NOT NULL DEFAULT 0,
            attempts INTEGER NOT NULL DEFAULT 0,
            error_message TEXT,
            status_message TEXT DEFAULT 'En cola',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_download_jobs_server_status ON download_jobs(server_id, status);
        CREATE INDEX IF NOT EXISTS idx_download_jobs_updated ON download_jobs(updated_at DESC);
    `);
}

export function jobToTask(job) {
    const isDone = job.status === 'completed';
    const isError = job.status === 'error';
    const isRunning = job.status === 'running' || job.status === 'queued' || job.status === 'retry';
    const total = Number(job.total_bytes || 0);
    const downloaded = Number(job.bytes_downloaded || 0);
    const progress = total > 0 ? Math.min(100, Math.floor((downloaded / total) * 100)) : (isDone ? 100 : 0);

    return {
        id: job.id,
        serverId: job.server_id,
        fileName: job.file_name,
        progress,
        status: isDone ? 'Completado' : isError ? 'Error' : (job.status_message || 'Descargando...'),
        isDone,
        isError
    };
}

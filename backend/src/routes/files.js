import express from 'express';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { execFile } from 'child_process';
import util from 'util';
import { pipeline } from 'stream/promises';
import { Readable, Transform } from 'stream';
import { requireAuth } from '../middleware/auth.js';
import { getServerByIdForUser } from '../services/serverService.js';
import { rustUtil } from '../utils/rustUtil.js';
import { PLAN_LIMITS } from '../config.js';
import { query } from '../db.js';
import crypto from 'crypto';
import net from 'net';
import dns from 'dns/promises';

const execFilePromise = util.promisify(execFile);
const router = express.Router();
const upload = multer({ dest: '/tmp/ragenodes_uploads/' });

// 🚀 MEMORIA GLOBAL PARA BARRA DE PROGRESO
// 🚀 MEMORIA GLOBAL PARA BARRA DE PROGRESO Y CACHÉ DE DISCO
const activeDownloads = new Map();
const storageCache = new Map(); // serverId -> { size, timestamp }
const DOWNLOAD_RETRY_LIMIT = Math.max(1, Number(process.env.DOWNLOAD_RETRY_LIMIT || 2));
const DOWNLOAD_JOB_RETENTION_MS = Math.max(60000, Number(process.env.DOWNLOAD_JOB_RETENTION_MS || 10 * 60 * 1000));
const configuredRemoteMaxBytes = Number(process.env.REMOTE_DOWNLOAD_MAX_BYTES);
const REMOTE_DOWNLOAD_MAX_BYTES = Number.isSafeInteger(configuredRemoteMaxBytes) && configuredRemoteMaxBytes >= 1024 * 1024
    ? configuredRemoteMaxBytes
    : 10 * 1024 * 1024 * 1024;
const REMOTE_REDIRECT_LIMIT = 5;
let downloadWorkerStarted = false;
let downloadWorkerBusy = false;


const getSafePath = (base, target) => {
    const resolvedBase = path.resolve(base);
    const cleanTarget = (target || '').replace(/^\/+/, '');
    const resolvedTarget = path.resolve(resolvedBase, cleanTarget || '.');

    if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
        throw new Error("Acceso denegado: Intento de Path Traversal detectado.");
    }
    return resolvedTarget;
};

// 🛡️ PROTECCIÓN VAULT: Función para verificar si un archivo está protegido
const isVaultProtected = (reqPath) => {
    if (!reqPath || !reqPath.includes('[market]')) return false;
    const fileName = path.basename(reqPath).toLowerCase();
    const ext = path.extname(reqPath).toLowerCase();
    
    // Archivos permitidos para editar en scripts del mercado
    const allowedLuaFiles = ['config.lua', 'shared.lua', 'fxmanifest.lua'];
    
    // Bloquear archivos .lua que NO estén en la lista de permitidos
    return ext === '.lua' && !allowedLuaFiles.includes(fileName);
};

async function getStorageAllowance(row, forceRefresh = false) {
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

async function checkStorageLimit(row, incomingBytes = 0, forceRefresh = false) {
    const { usedBytes, maxBytes } = await getStorageAllowance(row, forceRefresh);
    if ((usedBytes + incomingBytes) > maxBytes) {
        throw new Error(`Has alcanzado el límite de almacenamiento de tu plan (${maxBytes / (1024**3)} GB). Borra archivos o mejora tu plan.`);
    }
    return true;
}

function isForbiddenRemoteAddress(address) {
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
        return normalized === '::' || normalized === '::1'
            || normalized.startsWith('fc') || normalized.startsWith('fd')
            || /^fe[89ab]/.test(normalized)
            || normalized.startsWith('ff') || normalized.startsWith('2001:db8:');
    }
    return true;
}

async function validateRemoteUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || rawUrl.length > 2048) throw new Error('URL remota inválida.');
    let parsed;
    try { parsed = new URL(rawUrl); } catch { throw new Error('URL remota inválida.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error('Solo se permiten URLs HTTP/HTTPS públicas y sin credenciales.');
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
        throw new Error('No se permiten destinos de red internos.');
    }

    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => isForbiddenRemoteAddress(address))) {
        throw new Error('No se permiten destinos de red internos o reservados.');
    }
    return parsed;
}

async function fetchRemoteFile(rawUrl) {
    let currentUrl = rawUrl;
    for (let redirectCount = 0; redirectCount <= REMOTE_REDIRECT_LIMIT; redirectCount++) {
        const parsed = await validateRemoteUrl(currentUrl);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        let response;
        try {
            response = await fetch(parsed, { redirect: 'manual', signal: controller.signal });
        } finally {
            clearTimeout(timeout);
        }

        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            if (!location || redirectCount === REMOTE_REDIRECT_LIMIT) throw new Error('Demasiadas redirecciones remotas.');
            await response.body?.cancel().catch(() => {});
            currentUrl = new URL(location, parsed).toString();
            continue;
        }
        return response;
    }
    throw new Error('Demasiadas redirecciones remotas.');
}

function validateZipArchive(filePath, destination, maxExpandedBytes) {
    const zip = new AdmZip(filePath);
    let expandedBytes = 0;
    for (const entry of zip.getEntries()) {
        getSafePath(destination, entry.entryName);
        const unixMode = (Number(entry.header?.attr || 0) >>> 16) & 0xffff;
        if ((unixMode & 0o170000) === 0o120000) {
            throw new Error('El ZIP contiene enlaces simbólicos no permitidos.');
        }
        expandedBytes += Number(entry.header?.size || 0);
        if (!Number.isSafeInteger(expandedBytes) || expandedBytes > maxExpandedBytes) {
            throw new Error('El ZIP excede el espacio disponible al descomprimirse.');
        }
    }
    return zip;
}

async function extractZipNatively(filePath, destDir) {
    return await rustUtil.unzip(filePath, destDir);
}


function jobToTask(job) {
    return {
        id: job.id,
        serverId: job.server_id,
        fileName: job.file_name,
        status: job.status_message,
        progress: Number(job.progress || 0),
        isError: !!job.is_error,
        isFinished: !!job.is_finished
    };
}


async function ensureDownloadJobsTable() {
    await query(`
        CREATE TABLE IF NOT EXISTS download_jobs (
            id TEXT PRIMARY KEY,
            server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            url TEXT NOT NULL,
            target_path TEXT NOT NULL DEFAULT '/',
            file_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            status_message TEXT NOT NULL DEFAULT 'En cola...',
            progress INTEGER NOT NULL DEFAULT 0,
            bytes_downloaded BIGINT NOT NULL DEFAULT 0,
            bytes_total BIGINT NOT NULL DEFAULT 0,
            is_error BOOLEAN NOT NULL DEFAULT false,
            is_finished BOOLEAN NOT NULL DEFAULT false,
            error_message TEXT,
            attempts INTEGER NOT NULL DEFAULT 0,
            started_at TIMESTAMPTZ,
            finished_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_download_jobs_server_created ON download_jobs(server_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_download_jobs_status_created ON download_jobs(status, created_at ASC);
    `);
}

async function updateDownloadJob(jobId, patch) {
    const sets = [];
    const values = [];
    let idx = 1;
    let hasUpdatedAt = false;
    for (const [key, value] of Object.entries(patch)) {
        sets.push(`${key} = $${idx++}`);
        values.push(value);
        if (key === 'updated_at') hasUpdatedAt = true;
    }
    if (!hasUpdatedAt) {
        sets.push(`updated_at = NOW()`);
    }
    values.push(jobId);
    const { rows } = await query(
        `UPDATE download_jobs SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
    );
    if (rows[0]) activeDownloads.set(jobId, jobToTask(rows[0]));
    return rows[0];
}

async function finishDownloadJob(jobId, patch) {
    const job = await updateDownloadJob(jobId, {
        ...patch,
        finished_at: new Date(),
        updated_at: new Date()
    });
    setTimeout(() => activeDownloads.delete(jobId), DOWNLOAD_JOB_RETENTION_MS);
    return job;
}

async function claimNextDownloadJob() {
    const { rows } = await query(`
        UPDATE download_jobs
        SET status = 'running',
            status_message = 'Iniciando conexión...',
            progress = 0,
            is_error = false,
            is_finished = false,
            attempts = attempts + 1,
            started_at = NOW(),
            updated_at = NOW()
        WHERE id = (
            SELECT id FROM download_jobs
            WHERE status IN ('queued', 'retry')
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        RETURNING *
    `);
    if (rows[0]) activeDownloads.set(rows[0].id, jobToTask(rows[0]));
    return rows[0];
}

async function getServerForDownloadJob(job) {
    const { rows } = await query(`
        SELECT servers.*, users.extra_disk_gb
        FROM servers
        LEFT JOIN users ON servers.owner_id = users.id
        WHERE servers.id = $1
    `, [job.server_id]);
    return rows[0];
}

async function processDownloadJob(job) {
    const row = await getServerForDownloadJob(job);
    if (!row) throw new Error('Servidor no encontrado para esta descarga.');

    const targetDir = getSafePath(row.data_path, job.target_path || '/');
    const finalFile = getSafePath(targetDir, job.file_name);
    const tempFile = finalFile + '.descargando';

    await fs.mkdir(targetDir, { recursive: true });

    let downloadUrl = job.url;
    const gdriveMatch = downloadUrl.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (gdriveMatch && gdriveMatch[1]) {
        downloadUrl = `https://drive.google.com/uc?export=download&id=${gdriveMatch[1]}`;
    }

    const { remainingBytes } = await getStorageAllowance(row, true);
    const maxDownloadBytes = Math.min(remainingBytes, REMOTE_DOWNLOAD_MAX_BYTES);
    if (maxDownloadBytes < 1) throw new Error('No queda espacio disponible para la descarga.');

    const response = await fetchRemoteFile(downloadUrl);
    if (!response.ok) throw new Error(`El servidor remoto rechazó la descarga (HTTP ${response.status}).`);

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html') && job.file_name.toLowerCase().endsWith('.zip')) {
        throw new Error("El enlace es una página web (HTML), no un archivo descargable. (Si es Google Drive/MediaFire, el archivo es demasiado pesado y requiere que pases su captcha manualmente).");
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > maxDownloadBytes) throw new Error('El archivo remoto excede el espacio o tamaño máximo permitido.');

    let downloadedBytes = 0;
    let lastUpdate = Date.now();
    const progressTracker = new Transform({
        transform(chunk, encoding, callback) {
            downloadedBytes += chunk.length;
            if (downloadedBytes > maxDownloadBytes) {
                return callback(new Error('La descarga excede el espacio o tamaño máximo permitido.'));
            }

            if (Date.now() - lastUpdate > 500) {
                lastUpdate = Date.now();
                let pct = 100;
                let statusMsg = `Descargando... ${(downloadedBytes / (1024*1024)).toFixed(1)} MB`;
                if (contentLength > 0) {
                    pct = Math.min(100, Math.round((downloadedBytes / contentLength) * 100));
                    statusMsg = `Descargando... ${pct}%`;
                }
                updateDownloadJob(job.id, {
                    status_message: statusMsg,
                    progress: pct,
                    bytes_downloaded: downloadedBytes,
                    bytes_total: contentLength || 0
                }).catch(() => {});
            }
            callback(null, chunk);
        }
    });

    const fileStream = createWriteStream(tempFile);
    await pipeline(Readable.fromWeb(response.body), progressTracker, fileStream);

    await updateDownloadJob(job.id, {
        status_message: 'Verificando espacio...',
        progress: 100,
        bytes_downloaded: downloadedBytes,
        bytes_total: contentLength || downloadedBytes
    });
    await checkStorageLimit(row, 0, true);
    await fs.rename(tempFile, finalFile);

    if (job.file_name.toLowerCase().endsWith('.zip')) {
        await updateDownloadJob(job.id, { status_message: 'Descomprimiendo archivo...', progress: 100 });
        const allowance = await getStorageAllowance(row, true);
        const validatedZip = validateZipArchive(finalFile, targetDir, allowance.remainingBytes);
        const nativeResult = await extractZipNatively(finalFile, targetDir);
        if (nativeResult.success) {
            await fs.unlink(finalFile).catch(()=>{});
        } else {
            try {
                validatedZip.extractAllTo(targetDir, true);
                await fs.unlink(finalFile).catch(()=>{});
            } catch {
                throw new Error('El archivo ZIP se descargó pero está corrupto o protegido con contraseña.');
            }
        }
        storageCache.delete(row.id);
        await checkStorageLimit(row, 0, true);
    }

    await finishDownloadJob(job.id, {
        status: 'completed',
        status_message: '¡Operación Completada!',
        progress: 100,
        is_error: false,
        is_finished: true
    });
}

async function runDownloadWorkerTick() {
    if (downloadWorkerBusy) return;
    downloadWorkerBusy = true;
    try {
        const job = await claimNextDownloadJob();
        if (!job) return;
        try {
            await processDownloadJob(job);
        } catch (e) {
            console.error(`[Descarga Fallida] Job ${job.id}: ${e.message}`);
            const retryable = job.attempts < DOWNLOAD_RETRY_LIMIT;
            await updateDownloadJob(job.id, {
                status: retryable ? 'retry' : 'failed',
                status_message: retryable ? `Reintentando: ${e.message}` : `Error: ${e.message}`,
                progress: 100,
                is_error: !retryable,
                is_finished: false,
                error_message: e.message
            });
            if (!retryable) {
                setTimeout(() => activeDownloads.delete(job.id), DOWNLOAD_JOB_RETENTION_MS);
            }
            const row = await getServerForDownloadJob(job).catch(() => null);
            if (row) {
                const tempFile = getSafePath(getSafePath(row.data_path, job.target_path || '/'), job.file_name) + '.descargando';
                await fs.unlink(tempFile).catch(()=>{});
            }
        }
    } finally {
        downloadWorkerBusy = false;
    }
}

async function startDownloadWorker() {
    if (downloadWorkerStarted) return;
    downloadWorkerStarted = true;
    try {
        await ensureDownloadJobsTable();
        await query(`
            UPDATE download_jobs
            SET status = 'queued',
                status_message = 'Reanudando descarga tras reinicio...',
                updated_at = NOW()
            WHERE status = 'running'
        `);
    } catch (e) {
        console.warn('[DownloadQueue] No se pudo rearmar cola persistente:', e.message);
    }
    setInterval(runDownloadWorkerTick, 1500);
    setTimeout(runDownloadWorkerTick, 1000);
}

startDownloadWorker();

router.get('/list', requireAuth, async (req, res) => {
    const row = await getServerByIdForUser(req.query.serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    try {
        const reqPath = req.query.path || '/';
        const targetPath = getSafePath(row.data_path, reqPath);
        const items = await fs.readdir(targetPath, { withFileTypes: true });
        
        let formatted = items.map(item => ({
            name: item.name,
            isDirectory: item.isDirectory(),
            path: path.join(reqPath, item.name)
        }));

        // 🛡️ PROTECCIÓN VAULT: Filtrar archivos protegidos en [market]
        if (reqPath.includes('[market]')) {
            formatted = formatted.filter(item => {
                if (item.isDirectory) return true;
                return !isVaultProtected(path.join(reqPath, item.name));
            });
        }

        formatted.sort((a, b) => b.isDirectory - a.isDirectory || a.name.localeCompare(b.name));
        res.json({ items: formatted });
    } catch(e) { res.status(500).json({error: "Error listando el directorio: " + e.message}); }
});

router.get('/read', requireAuth, async (req, res) => {
    const row = await getServerByIdForUser(req.query.serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    try {
        const reqPath = req.query.path || 'server.cfg';
        if (isVaultProtected(reqPath)) {
            return res.status(403).json({ error: 'Vault™ Protection: Archivo fuente protegido. Solo se pueden editar archivos de configuración.' });
        }
        
        const targetPath = getSafePath(row.data_path, reqPath);
        const content = await fs.readFile(targetPath, 'utf8');
        res.json({ content });
    } catch(e) { res.status(500).json({error: `Error de lectura: ${e.message}`}); }
});

router.put('/write', requireAuth, async (req, res) => {
    const row = await getServerByIdForUser(req.body.serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    try {
        const reqPath = req.body.path || 'server.cfg';
        if (isVaultProtected(reqPath)) {
            return res.status(403).json({ error: 'Vault™ Protection: No puedes editar el código fuente de este script.' });
        }

        await checkStorageLimit(row, 1024 * 1024);
        const targetPath = getSafePath(row.data_path, reqPath);
        await fs.writeFile(targetPath, req.body.content, 'utf8');
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({error: e.message || "Error guardando el archivo"});
    }
});

router.post('/action', requireAuth, async (req, res) => {
    const row = await getServerByIdForUser(req.body.serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    try {
        const reqPath = req.body.path;
        if (isVaultProtected(reqPath)) {
            return res.status(403).json({ error: 'Vault™ Protection: Acción denegada en archivo protegido.' });
        }

        const targetPath = getSafePath(row.data_path, reqPath);

        if (req.body.action === 'mkdir') {
            await fs.mkdir(targetPath, { recursive: true });
        }
        else if (req.body.action === 'delete') {
            await fs.rm(targetPath, { recursive: true, force: true });
        }
        else if (req.body.action === 'createFile') {
            await fs.writeFile(targetPath, '', 'utf8');
        }
        else if (req.body.action === 'rename') {
            if (!req.body.newName) throw new Error("Nuevo nombre no proporcionado");
            const baseDir = path.dirname(targetPath);
            const newPathRelative = path.join(path.dirname(reqPath), req.body.newName);
            
            // 🛡️ VAULT: Si movemos algo que está en [market], el destino DEBE seguir estando en [market]
            if (reqPath.includes('[market]') && !newPathRelative.includes('[market]')) {
                return res.status(403).json({ error: 'Vault™ Protection: No puedes mover recursos del mercado fuera de su carpeta protegida.' });
            }

            const newPath = getSafePath(baseDir, req.body.newName);
            await fs.rename(targetPath, newPath);
        }
        // 🚀 NUEVA ACCIÓN: MOVER ARCHIVOS O CARPETAS
        else if (req.body.action === 'move') {
            if (!req.body.newPath) throw new Error("Ruta de destino no proporcionada");
            
            // 🛡️ VAULT: Si movemos algo que está en [market], el destino DEBE seguir estando en [market]
            if (reqPath.includes('[market]') && !req.body.newPath.includes('[market]')) {
                return res.status(403).json({ error: 'Vault™ Protection: No puedes mover recursos del mercado fuera de su carpeta protegida.' });
            }

            // Calculamos la nueva ruta absoluta asegurando que el cliente no salga de su servidor
            const newPath = getSafePath(row.data_path, req.body.newPath);
            
            // Magia extra: Si la carpeta de destino no existe, la creamos automáticamente
            await fs.mkdir(path.dirname(newPath), { recursive: true });
            
            // Movemos el archivo/carpeta a su nuevo hogar
            await fs.rename(targetPath, newPath);
        }
        else if (req.body.action === 'unzip') {
             const extractDir = path.dirname(targetPath);
             const allowance = await getStorageAllowance(row, true);
             const validatedZip = validateZipArchive(targetPath, extractDir, allowance.remainingBytes);

             const nativeResult = await extractZipNatively(targetPath, extractDir);

             if (!nativeResult.success) {
                 try {
                     validatedZip.extractAllTo(extractDir, true);
                 } catch (admErr) {
                     throw new Error(`Detalle Linux: ${nativeResult.error.substring(0, 150)} | Fallo Extra: El archivo supera la memoria máxima o está corrupto.`);
                 }
             }
             storageCache.delete(row.id);
             await checkStorageLimit(row, 0, true);
        }
        res.json({ success: true });
    } catch(e) { res.status(500).json({error: e.message || "Error ejecutando la acción"}); }
});

router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
    if(!req.file) return res.status(400).json({error: "No hay archivo"});
    const row = await getServerByIdForUser(req.body.serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) {
        await fs.unlink(req.file.path).catch(()=>{});
        return res.status(404).json({ error: 'No encontrado' });
    }

    try {
        await checkStorageLimit(row, req.file.size);

        const targetPath = getSafePath(row.data_path, req.body.path);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.copyFile(req.file.path, targetPath);
        await fs.unlink(req.file.path);
        res.json({ success: true });
    } catch(e) {
        await fs.unlink(req.file.path).catch(()=>{});
        res.status(500).json({error: e.message || "Error subiendo archivo."});
    }
});

// 🚀 CHUNK UPLOADS: Subir parte temporal
router.post('/upload-chunk', requireAuth, upload.single('file'), async (req, res) => {
    if(!req.file) return res.status(400).json({error: "No hay archivo"});
    const { uploadId, chunkIndex } = req.body;
    if (!uploadId || chunkIndex === undefined) return res.status(400).json({error: "Faltan parámetros de chunk"});
    
    try {
        const chunkPath = path.join('/tmp/ragenodes_uploads', `${uploadId}.part${chunkIndex}`);
        await fs.rename(req.file.path, chunkPath);
        res.json({ success: true });
    } catch(e) {
        await fs.unlink(req.file.path).catch(()=>{});
        res.status(500).json({error: e.message || "Error subiendo chunk."});
    }
});

// 🚀 CHUNK UPLOADS: Unir todas las partes
router.post('/upload-finish', requireAuth, async (req, res) => {
    const { uploadId, totalChunks, serverId, path: destPath, fileName, totalSize } = req.body;
    
    const row = await getServerByIdForUser(serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) return res.status(404).json({ error: 'No encontrado' });

    try {
        if (totalSize) await checkStorageLimit(row, Number(totalSize));

        const targetPath = getSafePath(row.data_path, destPath);
        const finalPath = getSafePath(path.dirname(targetPath), fileName);
        await fs.mkdir(path.dirname(finalPath), { recursive: true });

        const writeStream = createWriteStream(finalPath, { flags: 'w' });
        
        for (let i = 0; i < totalChunks; i++) {
            const chunkPath = path.join('/tmp/ragenodes_uploads', `${uploadId}.part${i}`);
            const data = await fs.readFile(chunkPath);
            writeStream.write(data);
            await fs.unlink(chunkPath).catch(()=>{}); 
        }
        
        writeStream.end();
        await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });

        res.json({ success: true });
    } catch(e) {
        for (let i = 0; i < totalChunks; i++) {
            await fs.unlink(path.join('/tmp/ragenodes_uploads', `${uploadId}.part${i}`)).catch(()=>{});
        }
        res.status(500).json({error: e.message || "Error finalizando subida."});
    }
});

router.get('/download', requireAuth, async (req, res) => {
    const row = await getServerByIdForUser(req.query.serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) return res.status(404).send('No encontrado');
    try {
        const reqPath = req.query.path;
        if (isVaultProtected(reqPath)) {
            return res.status(403).send('Vault™ Protection: Descarga del código fuente bloqueada.');
        }

        const targetPath = getSafePath(row.data_path, reqPath);
        res.download(targetPath);
    } catch (e) { res.status(400).send("Bad request"); }
});

router.get('/download-folder', requireAuth, async (req, res) => {
    const row = await getServerByIdForUser(req.query.serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) return res.status(404).send('No encontrado');
    try {
        const reqPath = req.query.path || '';
        
        // Evitar que descarguen carpetas que contengan el mercado entero para bypassear la protección
        if (reqPath.includes('[market]') || reqPath.endsWith('resources') || reqPath === '/' || reqPath === '') {
            return res.status(403).send('Vault™ Protection: No puedes descargar esta carpeta porque contiene código fuente protegido. Descarga archivos individuales si es necesario.');
        }

        const targetPath = getSafePath(row.data_path, reqPath);
        const folderName = path.basename(targetPath) || 'carpeta';

        // 🚀 OPTIMIZACIÓN: Usamos el motor de RUST para comprimir (No bloquea Node.js)
        const tempZipPath = `/tmp/RageNodes_${Date.now()}_${folderName}.zip`;
        const result = await rustUtil.compress(targetPath, tempZipPath);

        if (!result.success) throw new Error("Fallo en la compresión nativa.");

        res.download(tempZipPath, `${folderName}.zip`, (err) => {
            fs.unlink(tempZipPath).catch(() => {});
        });
    } catch (e) {
        res.status(500).send("Error empaquetando carpeta. Detalle: " + e.message);
    }
});

// 🚀 RUTA DE ESTADO: El frontend llama aquí para actualizar la barra
router.get('/download-status', requireAuth, async (req, res) => {
    const row = await getServerByIdForUser(req.query.serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) return res.status(404).json({ error: 'No encontrado' });

    const { rows } = await query(`
        SELECT *
        FROM download_jobs
        WHERE server_id = $1
          AND created_at > NOW() - INTERVAL '24 hours'
          AND (status IN ('queued', 'retry', 'running') OR finished_at > NOW() - INTERVAL '10 minutes' OR (is_error = true AND updated_at > NOW() - INTERVAL '1 minute'))
        ORDER BY created_at DESC
        LIMIT 20
    `, [row.id]);
    const tasks = rows.map(jobToTask);
    for (const task of activeDownloads.values()) {
        if (task.serverId === row.id && !tasks.find(t => t.id === task.id)) tasks.unshift(task);
    }
    res.json({ tasks });
});

// 🌟 DESCARGAS EN SEGUNDO PLANO (cola persistente en Postgres)
router.post('/download-remote', requireAuth, async (req, res) => {
    const row = await getServerByIdForUser(req.body.serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) return res.status(404).json({ error: 'No encontrado' });

    try {
        if (!req.body.url || !req.body.fileName) {
            return res.status(400).json({ error: 'URL y nombre de archivo son obligatorios.' });
        }

        await validateRemoteUrl(req.body.url);

        const targetDir = getSafePath(row.data_path, req.body.path || '/');
        getSafePath(targetDir, req.body.fileName);

        const taskId = `dl_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        await ensureDownloadJobsTable();
        const { rows } = await query(`
            INSERT INTO download_jobs (id, server_id, user_id, url, target_path, file_name, status, status_message, progress)
            VALUES ($1, $2, $3, $4, $5, $6, 'queued', 'En cola...', 0)
            RETURNING *
        `, [taskId, row.id, req.user.sub, req.body.url, req.body.path || '/', req.body.fileName]);

        activeDownloads.set(taskId, jobToTask(rows[0]));
        runDownloadWorkerTick().catch(() => {});
        res.json({ success: true, taskId, message: "Descarga encolada. Puedes ver el progreso en la esquina inferior derecha." });
    } catch(e) {
        res.status(500).json({ error: e.message || 'Error encolando descarga remota.' });
    }
});

export default router;

import { existsSync } from 'fs';
import { getFolderSize } from './serverNodeSelection.js';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, queryCached, logAudit } from '../db.js';
import { config, PLAN_LIMITS, generateSecurePassword } from '../config.js';
import * as Docker from './dockerService.js';
import { execFile } from 'child_process';
import { GameFactory } from './games/GameFactory.js';
import { rustUtil } from '../utils/rustUtil.js';
import { sendTeamInviteEmail } from './emailService.js';
import os from 'os';
import net from 'net';
import dgram from 'dgram';
import util from 'util';

export const repairBackoffCache = new Map();
const MAX_REPAIRS_PER_HOUR = 3;

export function shouldRepairWithBackoff(serverId) {
    const now = Date.now();
    const records = repairBackoffCache.get(serverId) || [];
    const recentRecords = records.filter(t => now - t < 3600000);
    if (recentRecords.length >= MAX_REPAIRS_PER_HOUR) {
        return false;
    }
    recentRecords.push(now);
    repairBackoffCache.set(serverId, recentRecords);
    return true;
}

export function verifyServerPort(ip, port, type) {
    return new Promise((resolve) => {
        const timeout = 3000;
        let resolved = false;

        if (type === 'tcp') {
            const socket = new net.Socket();
            socket.setTimeout(timeout);
            socket.on('connect', () => {
                if (!resolved) { resolved = true; socket.destroy(); resolve(true); }
            });
            socket.on('timeout', () => {
                if (!resolved) { resolved = true; socket.destroy(); resolve(false); }
            });
            socket.on('error', () => {
                if (!resolved) { resolved = true; socket.destroy(); resolve(false); }
            });
            socket.connect(port, ip);
        } else {
            resolve(true); // UDP fallback
        }
    });
}

const execFilePromise = util.promisify(execFile);

// 🧠 TRACKER DE ACTIVIDAD PARA ENTORNOS 3D (Auto-apagado por inactividad)
export const blenderActivity = new Map();
const BLENDER_INACTIVITY_MS = 30 * 60 * 1000; // 30 minutos

// 🔥 PLANES: Importados desde config.js como fuente única de verdad.
const PLANS = Object.entries(PLAN_LIMITS).reduce((acc, [key, val]) => {
  const diskBytes = val.diskBytes || ((val.diskGb || 20) * 1024 ** 3);
  acc[key] = {
    ...val,
    diskBytes,
    storageLimit: val.storageLimit || `${Math.round(diskBytes / 1024 ** 3)}G`,
    allowedTemplates: val.allowedTemplates || ['minecraft', 'fivem']
  };
  return acc;
}, {});
const DOCKER_QUERY_CHUNK_SIZE = Math.max(1, Number(process.env.DOCKER_QUERY_CHUNK_SIZE || 5));
const MAINTENANCE_CHUNK_SIZE = Math.max(1, Number(process.env.MAINTENANCE_CHUNK_SIZE || 3));
const MAINTENANCE_INTERVAL_MS = Math.max(300000, Number(process.env.MAINTENANCE_INTERVAL_MS || 600000)); // 10 minutes default

// 🧠 CACHE DE TAMAÑO DE DISCO (Para no saturar I/O)
const diskSizeCache = new Map();
const DISK_CACHE_TTL = 60 * 1000; // 1 minuto
const inflightDiskRequests = new Map(); // Para evitar escaneos simultáneos de la misma carpeta

// Función optimizada con Rust, Caché y Promesas In-Flight.
// Los listados usan stale-while-revalidate para no bloquear requests con escaneos de disco.
function refreshFolderSize(dirPath) {
    if (!dirPath || inflightDiskRequests.has(dirPath)) return inflightDiskRequests.get(dirPath);

    const promise = rustUtil.getDirSize(dirPath).then(size => {
        diskSizeCache.set(dirPath, { size, time: Date.now() });
        inflightDiskRequests.delete(dirPath);
        return size;
    }).catch(err => {
        inflightDiskRequests.delete(dirPath);
        console.warn(`[DiskCache] No se pudo calcular tamaño de ${dirPath}:`, err.message);
        return diskSizeCache.get(dirPath)?.size || 0;
    });

    inflightDiskRequests.set(dirPath, promise);
    return promise;
}


export { getFolderSize, getNodeRuntimeUsage, nodeCanAcceptDockerWorkload, selectDeploymentNode, getNextAvailablePort } from './serverNodeSelection.js';
export { getSubusersForServer, addSubuserToServer, removeSubuserFromServer } from './serverSubusers.js';
export { setServerBackupTime, updateServerWebhook, updateServerCluster, updateServerAutoRestart, toggleBlenderForServer, renewBlenderHeartbeat } from './serverSettings.js';

export async function getServersForUser(userId, isAdmin = false) {
  const sql = isAdmin ? 'SELECT servers.*, users.extra_disk_gb FROM servers LEFT JOIN users ON servers.owner_id = users.id ORDER BY servers.created_at DESC' : 'SELECT servers.*, users.extra_disk_gb FROM servers LEFT JOIN users ON servers.owner_id = users.id WHERE servers.owner_id = $1 OR servers.id IN (SELECT server_id FROM subusers WHERE user_id = $1) ORDER BY servers.created_at DESC';
  const servers = (await queryCached(sql, isAdmin ? [] : [userId], 3)).rows;

  // Lotes (chunks) para no saturar Docker con Promesas concurrentes masivas
  const CHUNK_SIZE = DOCKER_QUERY_CHUNK_SIZE;
  for (let i = 0; i < servers.length; i += CHUNK_SIZE) {
      const chunk = servers.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(async (s) => {
         const shortId = s.id.slice(0,8);

         if (s.template === 'ark' && !s.db_name) {
             console.warn(`[ServersList] ARK ${s.name} no tiene credenciales DB; omitiendo autocreación en request de lectura.`);
         }

         const [bState, state] = await Promise.all([
             Docker.resolveContainerState(`ragenodes-blender-${shortId}`),
             Docker.resolveContainerState(s.container_name),
         ]);
         const usedDiskBytes = await getFolderSize(s.data_path);

         s.blender_status = bState.running ? 'running' : 'stopped';
         let hasIcon = false;
         if (s.template === 'fivem' && s.db_name && s.data_path) {
             const iconPath = path.join(s.data_path, 'txData', `${s.db_name}.base`, 'icon.png');
             hasIcon = existsSync(iconPath);
         }
         s.has_icon = hasIcon;
         delete s.blender_pass;
         if (!isAdmin && s.owner_id !== userId) {
             delete s.db_name;
             delete s.db_user;
             delete s.db_pass;
             delete s.discord_webhook_url;
             delete s.data_path;
             delete s.container_name;
             delete s.license_key_hint;
             delete s.subuser_permissions;
         }
         s.status = !state.exists ? 'missing' : (state.running ? 'running' : 'stopped');

         const plan = PLANS[s.runtime_plan] || PLANS.hobby;
         const maxDisk = (plan.diskBytes || (20 * 1024 ** 3)) + ((s.extra_disk_gb || 0) * 1024 ** 3);
         const diskPercent = Math.min(((usedDiskBytes / maxDisk) * 100), 100);
         const diskGb = usedDiskBytes / (1024 ** 3);

         if (s.status === 'running') {
             s.stats = await Docker.getContainerStats(s.container_name);
             s.stats.disk = diskPercent;
             s.stats.diskGb = diskGb;
         } else {
             s.stats = { cpu: 0, ram: 0, ramGb: 0, disk: diskPercent, diskGb: diskGb };
         }
      }));
  }

  return servers;
}

export async function getServerByIdForUser(id, userId, isAdmin = false, requiredPermission = null) {
  const sql = isAdmin
    ? 'SELECT servers.*, users.extra_disk_gb FROM servers LEFT JOIN users ON servers.owner_id = users.id WHERE servers.id = $1'
    : `SELECT servers.*, users.extra_disk_gb, su.permissions AS subuser_permissions
       FROM servers
       LEFT JOIN users ON servers.owner_id = users.id
       LEFT JOIN subusers su ON su.server_id = servers.id AND su.user_id = $2
       WHERE servers.id = $1 AND (servers.owner_id = $2 OR su.user_id = $2)`;
  const server = (await queryCached(sql, isAdmin ? [id] : [id, userId], 2)).rows[0];
  if (!server || isAdmin || server.owner_id === userId || !requiredPermission) return server;

  const permissions = Array.isArray(server.subuser_permissions) ? server.subuser_permissions : [];
  return permissions.includes(requiredPermission) ? server : undefined;
}

async function getNextAvailablePort(startPort, range = 1, targetNodeId = 0) {
    const nodeOffset = Number(targetNodeId) * 1000;
    startPort = startPort + nodeOffset + (config.portBaseOffset || 0);

    const maxScan = Number(process.env.PORT_SCAN_LIMIT || 5000);
    const endPort = Math.min(65535, startPort + maxScan);
  if (!Number.isInteger(startPort) || startPort <= 0 || startPort > 65535) {
    throw new Error(`Puerto inicial inválido: ${startPort}`);
  }
  if (!Number.isInteger(range) || range <= 0 || startPort + range - 1 > 65535) {
    throw new Error(`Rango de puertos inválido: inicio=${startPort}, rango=${range}`);
  }

  const { rows } = await query(`
    SELECT fivem_port as port FROM servers WHERE fivem_port IS NOT NULL
    UNION
    SELECT txadmin_port as port FROM servers WHERE txadmin_port IS NOT NULL
    UNION
    SELECT blender_port as port FROM servers WHERE blender_port IS NOT NULL
  `);
  const usedPorts = new Set(rows.map(r => Number(r.port)).filter(Boolean));

  try {
      const containers = await Docker.localDocker.listContainers();
      for (const c of containers) {
          if (c.Ports) {
              for (const p of c.Ports) {
                  if (p.PublicPort) usedPorts.add(Number(p.PublicPort));
              }
          }
      }
  } catch (e) {
      console.warn('[Ports] No se pudieron leer puertos publicados desde Docker:', e.message);
  }

  for (let port = startPort; port + range - 1 <= endPort; port++) {
    let blockFree = true;
    for (let i = 0; i < range; i++) {
        if (usedPorts.has(port + i)) {
            blockFree = false;
            break;
        }
    }
    if (blockFree) return port;
  }

  throw new Error(`No hay puertos disponibles entre ${startPort} y ${endPort} para un bloque de ${range}. Libera puertos o amplía PORT_SCAN_LIMIT.`);
}

const userCreationLocks = new Map();

export { createServerForUser } from './serverCreationService.js';

export async function getServerDetails(id, userId, isAdmin) {
  const s = await getServerByIdForUser(id, userId, isAdmin);
  if (!s) return null;
  const canViewSecrets = isAdmin || s.owner_id === userId;

  // 🦖 Auto-crear base de datos para servidores ARK existentes si no la tienen
  if (canViewSecrets && s.template === 'ark' && !s.db_name) {
    const shortId = s.id.slice(0,8);
    const dbName = `ark_${shortId.replace(/-/g, '_')}`;
    const dbUser = `usr_${shortId}`;
    const dbPass = generateSecurePassword();
    try {
        const dbConnection = await mysql.createConnection({
            host: 'mariadb', user: 'root', password: config.centralDbPass
        });
        const escapedDbName = mysql.escapeId(dbName);
        await dbConnection.query(`CREATE DATABASE IF NOT EXISTS ${escapedDbName}`);
        await dbConnection.query(`CREATE USER IF NOT EXISTS ?@'%' IDENTIFIED BY ?`, [dbUser, dbPass]);
        await dbConnection.query(`GRANT ALL PRIVILEGES ON ${escapedDbName}.* TO ?@'%'`, [dbUser]);
        await dbConnection.query(`FLUSH PRIVILEGES`);
        await dbConnection.end();

        await query('UPDATE servers SET db_name = $1, db_user = $2, db_pass = $3 WHERE id = $4', [dbName, dbUser, dbPass, s.id]);
        s.db_name = dbName;
        s.db_user = dbUser;
        s.db_pass = dbPass;
    } catch (e) {
        console.error(`❌ Error auto-creando BD para ARK ${s.name}:`, e.message);
    }
  }

  const state = await Docker.resolveContainerState(s.container_name);
  s.status = !state.exists ? 'missing' : (state.running ? 'running' : 'stopped');
  const usedDiskBytes = await getFolderSize(s.data_path);
  const plan = PLANS[s.runtime_plan] || PLANS.hobby;
  const maxDisk = (plan.diskBytes || (20 * 1024 ** 3)) + ((s.extra_disk_gb || 0) * 1024 ** 3);
  const diskPercent = Math.min(((usedDiskBytes / maxDisk) * 100), 100);
  const diskGb = usedDiskBytes / (1024 ** 3);

  if (s.status === 'running') {
      s.stats = await Docker.getContainerStats(s.container_name);
      s.stats.disk = diskPercent;
      s.stats.diskGb = diskGb;
  } else {
      s.stats = { cpu: 0, ram: 0, ramGb: 0, disk: diskPercent, diskGb: diskGb };
  }

  const bState = await Docker.resolveContainerState(`ragenodes-blender-${s.id.slice(0,8)}`);
  s.blender_status = bState.running ? 'running' : 'stopped';
  let hasIcon = false;
  if (s.template === 'fivem' && s.db_name && s.data_path) {
      const iconPath = path.join(s.data_path, 'txData', `${s.db_name}.base`, 'icon.png');
      hasIcon = existsSync(iconPath);
  }
  s.has_icon = hasIcon;
  if (!canViewSecrets) {
      delete s.db_name;
      delete s.db_user;
      delete s.db_pass;
      delete s.blender_pass;
      delete s.discord_webhook_url;
      delete s.data_path;
      delete s.container_name;
      delete s.license_key_hint;
      delete s.subuser_permissions;
  }
  return s;
}

export async function getServerLogs(id, userId, isAdmin) {
  const s = await getServerByIdForUser(id, userId, isAdmin, 'console');
  if (!s) throw new Error('Servidor no encontrado o sin permiso de consola.');
  return { logs: await Docker.fetchContainerLogs(s.container_name) };
}

export async function getAllServers() {
  const { rows } = await query('SELECT * FROM servers');
  return rows;
}

export async function getServerStatsHistory(id, userId, isAdmin) {
    const s = await getServerByIdForUser(id, userId, isAdmin);
    if (!s) throw new Error("Servidor no encontrado");
    const { rows } = await query('SELECT cpu, ram, ram_gb, created_at FROM server_stats_history WHERE server_id = $1 ORDER BY created_at DESC LIMIT 50', [s.id]);
    return rows.reverse();
}

export { controlServer, deleteServer, repairServer, repairOneServer } from './serverControlService.js';

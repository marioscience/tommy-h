import { existsSync } from 'fs';
import path from 'path';
import { config, PLAN_LIMITS, generateSecurePassword } from '../config.js';
import * as Docker from './dockerService.js';
import net from 'net';
import { createGameDatabase } from './gameDatabaseService.js';
import {
  findServerAccessibleToUser,
  listAllServers,
  listServersAccessibleToUser,
  listServerStatsHistory,
  updateServerDatabaseCredentials
} from '../repositories/serverRepository.js';
import { getCachedDiskUsage } from './diskUsageService.js';

export const repairBackoffCache = new Map();
const MAX_REPAIRS_PER_HOUR = 3;

export function shouldRepairWithBackoff(serverId) {
    const now = Date.now();
    if (repairBackoffCache.size > 10000) {
        for (const [id, timestamps] of repairBackoffCache) {
            if (!timestamps.some(timestamp => now - timestamp < 3600000)) repairBackoffCache.delete(id);
        }
    }
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

export async function getServersForUser(userId, isAdmin = false) {
  const servers = await listServersAccessibleToUser(userId, isAdmin);

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
         const diskUsage = await getCachedDiskUsage(s.id);
         const usedDiskBytes = diskUsage.bytes;

         s.blender_status = bState.running ? 'running' : 'stopped';
         let hasIcon = false;
         if (s.template === 'fivem' && s.db_name && s.data_path) {
             const iconPath = path.join(s.data_path, 'txData', `${s.db_name}.base`, 'icon.png');
             hasIcon = existsSync(iconPath);
         }
         s.has_icon = hasIcon;
         if ((isAdmin || s.owner_id === userId) && s.template === 'fivem') {
             s.db_host = config.gameDatabaseHost;
             s.db_port = config.gameDatabasePort;
         }
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
             s.stats.diskUpdatedAt = diskUsage.updatedAt;
             s.stats.diskPending = diskUsage.pending;
         } else {
             s.stats = { cpu: 0, ram: 0, ramGb: 0, disk: diskPercent, diskGb, diskUpdatedAt: diskUsage.updatedAt, diskPending: diskUsage.pending };
         }
      }));
  }

  return servers;
}

export async function getServerByIdForUser(id, userId, isAdmin = false, requiredPermission = null) {
  const server = await findServerAccessibleToUser(id, userId, isAdmin);
  if (!server || isAdmin || server.owner_id === userId || !requiredPermission) return server;

  const permissions = Array.isArray(server.subuser_permissions) ? server.subuser_permissions : [];
  return permissions.includes(requiredPermission) ? server : undefined;
}

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
        await createGameDatabase(dbName, dbUser, dbPass);
        await updateServerDatabaseCredentials(s.id, { dbName, dbUser, dbPass });
        s.db_name = dbName;
        s.db_user = dbUser;
        s.db_pass = dbPass;
    } catch (e) {
        console.error(`❌ Error auto-creando BD para ARK ${s.name}:`, e.message);
    }
  }

  const state = await Docker.resolveContainerState(s.container_name);
  s.status = !state.exists ? 'missing' : (state.running ? 'running' : 'stopped');
  const diskUsage = await getCachedDiskUsage(s.id);
  const usedDiskBytes = diskUsage.bytes;
  const plan = PLANS[s.runtime_plan] || PLANS.hobby;
  const maxDisk = (plan.diskBytes || (20 * 1024 ** 3)) + ((s.extra_disk_gb || 0) * 1024 ** 3);
  const diskPercent = Math.min(((usedDiskBytes / maxDisk) * 100), 100);
  const diskGb = usedDiskBytes / (1024 ** 3);

  if (s.status === 'running') {
      s.stats = await Docker.getContainerStats(s.container_name);
      s.stats.disk = diskPercent;
      s.stats.diskGb = diskGb;
      s.stats.diskUpdatedAt = diskUsage.updatedAt;
      s.stats.diskPending = diskUsage.pending;
  } else {
      s.stats = { cpu: 0, ram: 0, ramGb: 0, disk: diskPercent, diskGb, diskUpdatedAt: diskUsage.updatedAt, diskPending: diskUsage.pending };
  }

  const bState = await Docker.resolveContainerState(`ragenodes-blender-${s.id.slice(0,8)}`);
  s.blender_status = bState.running ? 'running' : 'stopped';
  let hasIcon = false;
  if (s.template === 'fivem' && s.db_name && s.data_path) {
      const iconPath = path.join(s.data_path, 'txData', `${s.db_name}.base`, 'icon.png');
      hasIcon = existsSync(iconPath);
  }
  s.has_icon = hasIcon;
  if (canViewSecrets && s.template === 'fivem') {
      s.db_host = config.gameDatabaseHost;
      s.db_port = config.gameDatabasePort;
  }
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
  return listAllServers();
}

export async function getServerStatsHistory(id, userId, isAdmin) {
    const s = await getServerByIdForUser(id, userId, isAdmin);
    if (!s) throw new Error("Servidor no encontrado");
    return (await listServerStatsHistory(s.id)).reverse();
}

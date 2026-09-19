import { query, logAudit } from '../db.js';
import { getServerByIdForUser } from './serverService.js';
import { toggleBlender as toggleBlenderContainer } from './blenderRuntimeService.js';
import { blenderActivity } from './serverService.js';

export async function setServerBackupTime(id, userId, time, isAdmin) {
  const s = await getServerByIdForUser(id, userId, isAdmin, 'settings');
  if (!s) throw new Error('Servidor no encontrado o sin permisos');

  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(time)) {
    throw new Error('Formato de hora invalido. Usa HH:MM (ej. 04:00)');
  }

  await query('UPDATE servers SET backup_time = $1 WHERE id = $2', [time, id]);
  await logAudit(userId, 'server.update_backup_time', { serverId: id, backup_time: time });
  return { success: true, backup_time: time };
}

export async function updateServerWebhook(serverId, userId, isAdmin, webhookUrl, events) {
  const s = await getServerByIdForUser(serverId, userId, isAdmin, 'settings');
  if (!s) throw new Error('Servidor no encontrado o sin permisos');

  if (webhookUrl && !webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
    throw new Error('La URL del webhook debe comenzar con https://discord.com/api/webhooks/');
  }

  const validEvents = ['online', 'offline', 'player_join', 'player_leave', 'update'];
  const sanitizedEvents = Array.isArray(events) ? events.filter(e => validEvents.includes(e)) : [];

  await query('UPDATE servers SET discord_webhook_url = $1, discord_webhook_events = $2 WHERE id = $3',
              [webhookUrl || null, JSON.stringify(sanitizedEvents), serverId]);

  await logAudit(userId, 'server.update_webhook', { serverId, webhookUrl: !!webhookUrl, events: sanitizedEvents });
  return { success: true };
}

export async function updateServerCluster(serverId, userId, isAdmin, clusterId) {
  const s = await getServerByIdForUser(serverId, userId, isAdmin, 'settings');
  if (!s) throw new Error('Servidor no encontrado o sin permisos');

  if (s.template !== 'ark') {
    throw new Error('La configuracion de Cluster solo esta disponible para servidores de ARK');
  }

  const sanitizedCluster = clusterId ? String(clusterId).trim().replace(/[^a-zA-Z0-9_-]/g, '') : null;

  await query('UPDATE servers SET cluster_id = $1 WHERE id = $2', [sanitizedCluster, serverId]);
  await logAudit(userId, 'server.update_cluster', { serverId, clusterId: sanitizedCluster });
  return { success: true, cluster_id: sanitizedCluster };
}

export async function updateServerAutoRestart(serverId, userId, isAdmin, time, enabled, backupBeforeRestart) {
  const s = await getServerByIdForUser(serverId, userId, isAdmin, 'settings');
  if (!s) throw new Error('Servidor no encontrado o sin permisos');

  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (enabled && !timeRegex.test(time)) {
    throw new Error('Formato de hora invalido. Usa HH:MM (ej. 06:00)');
  }

  await query(
    'UPDATE servers SET auto_restart_time = $1, auto_restart_enabled = $2, backup_before_restart = $3 WHERE id = $4',
    [time || '06:00', !!enabled, backupBeforeRestart !== false, serverId]
  );

  await logAudit(userId, 'server.update_auto_restart', { serverId, time, enabled: !!enabled, backupBeforeRestart: backupBeforeRestart !== false });
  return { success: true };
}

export async function toggleBlenderForServer(id, userId, isAdmin, action) {
  const s = await getServerByIdForUser(id, userId, isAdmin, 'settings');
  if (!s) throw new Error('Servidor no encontrado o sin permisos');

  if (String(s.template).toLowerCase() !== 'fivem') {
    throw new Error('Este servidor no soporta Blender Studio 3D');
  }

  const res = await toggleBlenderContainer({
    nodeId: s.node_id,
    serverId: s.id,
    dataPath: s.data_path,
    blenderPass: s.blender_pass,
    blenderPort: s.blender_port
  }, action);
  if (action === 'start') {
    blenderActivity.set(s.id, Date.now());
  } else if (action === 'stop') {
    blenderActivity.delete(s.id);
  }
  return res;
}

export async function renewBlenderHeartbeat(id, userId, isAdmin) {
  const s = await getServerByIdForUser(id, userId, isAdmin, 'console');
  if (!s) throw new Error('Servidor no encontrado');
  blenderActivity.set(s.id, Date.now());
  return { success: true };
}

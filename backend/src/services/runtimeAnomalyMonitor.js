import { config } from '../config.js';
import { listActiveNodeIds } from '../repositories/nodeRepository.js';
import {
  listServerRuntimeIdentities,
  updateServerStatus
} from '../repositories/serverRepository.js';
import { createNotification } from '../repositories/notificationRepository.js';
import { getNodeConnection } from './dockerUtils.js';

const ALERT_COOLDOWN_MS = 60 * 60 * 1000;
const recentAlerts = new Map();

function normalizedThresholds() {
  const alert = Math.max(32, Number(config.runtimeProcessAlertThreshold) || 512);
  const stop = Math.max(alert + 1, Number(config.runtimeProcessStopThreshold) || 4096);
  return { alert, stop };
}

export function assessRuntimeProcessRisk(processCount, isRegistered, thresholds = normalizedThresholds()) {
  const count = Math.max(0, Number(processCount) || 0);
  if (count >= thresholds.stop) return { level: 'critical', processCount: count };
  if (count >= thresholds.alert) return { level: 'warning', processCount: count };
  if (!isRegistered) return { level: 'orphan', processCount: count };
  return { level: 'normal', processCount: count };
}

function shouldNotify(key, now = Date.now()) {
  const previous = recentAlerts.get(key) || 0;
  if (now - previous < ALERT_COOLDOWN_MS) return false;
  recentAlerts.set(key, now);
  return true;
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function reportFinding(finding) {
  const key = `${finding.nodeId}:${finding.containerName}:${finding.level}`;
  if (!shouldNotify(key)) return;

  const title = finding.level === 'critical'
    ? '[Seguridad] Contenedor detenido por saturación de procesos'
    : finding.level === 'orphan'
      ? '[Seguridad] Contenedor huérfano detectado'
      : '[Seguridad] Acumulación anómala de procesos';
  const content = [
    `Contenedor: ${finding.containerName}`,
    `Nodo: ${finding.nodeId}`,
    `Procesos: ${finding.processCount}`,
    `Registrado: ${finding.registered ? 'sí' : 'no'}`,
    finding.action ? `Acción: ${finding.action}` : null
  ].filter(Boolean).join(' | ');

  console.warn('[RuntimeSecurity]', JSON.stringify(finding));
  await createNotification({
    title,
    content,
    type: finding.level === 'critical' ? 'error' : 'warning',
    audience: 'admin'
  });
}

async function inspectRuntimeContainer(docker, nodeId, info, registeredServer, thresholds) {
  const containerName = String(info.Names?.[0] || '').replace(/^\//, '');
  const registered = Boolean(registeredServer);
  let processCount = 0;

  try {
    const stats = await withTimeout(
      docker.getContainer(info.Id).stats({ stream: false }),
      5000,
      `Docker stats timeout for ${containerName}`
    );
    processCount = Number(stats?.pids_stats?.current || 0);
  } catch (error) {
    console.warn(`[RuntimeSecurity] No se pudo medir ${containerName}: ${error.message}`);
    return;
  }

  const risk = assessRuntimeProcessRisk(processCount, registered, thresholds);
  if (risk.level === 'normal') return;

  const finding = {
    timestamp: new Date().toISOString(),
    nodeId,
    containerId: info.Id,
    containerName,
    image: info.Image,
    registered,
    serverId: registeredServer?.id || null,
    level: risk.level,
    processCount: risk.processCount,
    action: risk.level === 'critical' ? 'stop-preserve-evidence' : 'alert-only'
  };

  if (risk.level === 'critical') {
    // A manual Docker stop preserves the container metadata, writable layer,
    // logs and bind-mounted data while reaping every child of its PID namespace.
    let stopped = true;
    await docker.getContainer(info.Id).stop({ t: 30 }).catch((error) => {
      stopped = false;
      finding.action = `stop-failed: ${error.message}`;
    });
    if (stopped && registeredServer) await updateServerStatus(registeredServer.id, 'error');
  }

  await reportFinding(finding);
}

export async function scanRuntimeAnomalies() {
  const servers = await listServerRuntimeIdentities();
  const serversByContainer = new Map(servers.map((server) => [server.container_name, server]));
  const configuredNodeIds = await listActiveNodeIds();
  const nodeIds = [...new Set([0, ...configuredNodeIds])];
  const thresholds = normalizedThresholds();

  for (const nodeId of nodeIds) {
    try {
      const docker = await getNodeConnection(nodeId);
      const containers = await docker.listContainers();
      const escapedPrefix = config.containerPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const gameContainerPattern = new RegExp(`^${escapedPrefix}[0-9a-f]{8}(?:-db)?$`, 'i');
      const candidates = containers.filter((info) => {
        const name = String(info.Names?.[0] || '').replace(/^\//, '');
        return gameContainerPattern.test(name);
      });

      for (let index = 0; index < candidates.length; index += 4) {
        const batch = candidates.slice(index, index + 4);
        const results = await Promise.allSettled(batch.map((info) => {
          const name = String(info.Names?.[0] || '').replace(/^\//, '');
          const primaryName = name.endsWith('-db') ? name.slice(0, -3) : name;
          return inspectRuntimeContainer(docker, nodeId, info, serversByContainer.get(primaryName), thresholds);
        }));
        for (const result of results) {
          if (result.status === 'rejected') {
            console.error(`[RuntimeSecurity] No se pudo procesar un contenedor del nodo ${nodeId}: ${result.reason?.message || result.reason}`);
          }
        }
      }
    } catch (error) {
      console.error(`[RuntimeSecurity] Falló el escaneo del nodo ${nodeId}: ${error.message}`);
    }
  }
}

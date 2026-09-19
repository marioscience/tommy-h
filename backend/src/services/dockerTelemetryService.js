import { config } from '../config.js';
import { redisClient } from '../db.js';
import { rustUtil } from '../utils/rustUtil.js';
import { promiseWithTimeout } from '../utils/promiseWithTimeout.js';
import { listActiveNodeIds, listActiveNodes, updateNodeCapacity } from '../repositories/nodeRepository.js';
import { getDockerForContainer } from './dockerUtils.js';
import { getNodeConnection } from './dockerNodeService.js';

const STATS_CACHE = new Map();

export async function startDockerTelemetryCollector() {
  console.log('📊 [StatsCollector] Iniciando recolector de telemetría multi-nodo...');
  while (true) {
    try {
      const nodeIds = await listActiveNodeIds();
      for (const nodeId of nodeIds) {
        try {
          const docker = await getNodeConnection(nodeId);
          const containers = await docker.listContainers();
          const managed = containers.filter(container =>
            container.Names[0].startsWith(`/${config.containerPrefix}`)
            && !container.Names[0].startsWith('/ragenodes-blender-'));

          for (let index = 0; index < managed.length; index += 15) {
            const samples = await Promise.all(managed.slice(index, index + 15).map(async containerInfo => {
              try {
                const stats = await docker.getContainer(containerInfo.Id).stats({ stream: false });
                return { containerInfo, stats };
              } catch {
                return null;
              }
            }));
            const available = samples.filter(Boolean);
            const results = await rustUtil.calculateStatsBatch(available.map(sample => sample.stats));
            for (let resultIndex = 0; resultIndex < available.length; resultIndex += 1) {
              const result = results[resultIndex];
              if (!result) continue;
              const key = available[resultIndex].containerInfo.Names[0].replace('/', '');
              const payload = {
                cpu: result.cpu, ram: result.ram, ramGb: result.ram_gb,
                net_rx: result.net_rx, net_tx: result.net_tx,
                disk: '0.0', diskGb: '0.0', updatedAt: Date.now(), nodeId
              };
              STATS_CACHE.set(key, payload);
              if (redisClient?.isOpen) {
                redisClient.setEx(`ragenodes:stats:${key}`, 60, JSON.stringify(payload)).catch(() => {});
              }
            }
          }
        } catch (error) {
          console.error(`⚠️ [Stats] Error en nodo ${nodeId}:`, error.message);
        }
      }
    } catch (error) {
      console.error('❌ Error en StatsCollector:', error);
    }
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
}

export function startNodeMonitor() {
  console.log('🖥️ [NodeMonitor] Iniciando monitoreo de nodos...');
  return setInterval(async () => {
    try {
      const nodes = await listActiveNodes();
      for (const node of nodes) {
        try {
          const info = await (await getNodeConnection(node.id)).info();
          await updateNodeCapacity(node.id, Math.round(info.MemTotal / 1024 ** 3), info.NCPU);
        } catch {}
      }
    } catch {}
  }, 60000);
}

export async function getContainerStats(name, { force = false } = {}) {
  const cached = STATS_CACHE.get(name);
  const cacheAgeMs = cached?.updatedAt ? Date.now() - cached.updatedAt : Number.POSITIVE_INFINITY;
  if (!force && cached && cacheAgeMs < 15000) return cached;

  if (!force && redisClient?.isOpen) {
    try {
      const raw = await promiseWithTimeout(redisClient.get(`ragenodes:stats:${name}`), 300);
      if (raw) {
        const parsed = JSON.parse(raw);
        STATS_CACHE.set(name, parsed);
        return parsed;
      }
    } catch {}
  }

  try {
    const container = (await getDockerForContainer(name)).getContainer(name);
    const stats = await promiseWithTimeout(container.stats({ stream: false }), 2500, 'Docker stats timeout');
    const result = await rustUtil.calculateStats(stats);
    if (result) {
      const normalized = {
        cpu: result.cpu ?? '0.0', ram: result.ram ?? '0.0',
        ramGb: result.ram_gb ?? result.ramGb ?? '0.0',
        net_rx: result.net_rx ?? '0', net_tx: result.net_tx ?? '0',
        disk: cached?.disk ?? '0.0', diskGb: cached?.diskGb ?? '0.0', updatedAt: Date.now()
      };
      STATS_CACHE.set(name, normalized);
      if (redisClient?.isOpen) {
        redisClient.setEx(`ragenodes:stats:${name}`, 60, JSON.stringify(normalized)).catch(() => {});
      }
      return normalized;
    }
  } catch {
    if (cached) return cached;
  }

  return {
    cpu: '0.0', ram: '0.0', ramGb: '0.0',
    disk: cached?.disk ?? '0.0', diskGb: cached?.diskGb ?? '0.0', updatedAt: Date.now()
  };
}

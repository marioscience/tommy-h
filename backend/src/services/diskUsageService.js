import { ensureRedis, redisClient } from '../db.js';
import { listAllServers } from '../repositories/serverRepository.js';
import { promiseWithTimeout } from '../utils/promiseWithTimeout.js';
import { getFolderSize } from './serverNodeSelection.js';

const DISK_USAGE_CACHE = new Map();
const intervalMs = Math.max(60_000, Number(process.env.DISK_USAGE_COLLECTION_INTERVAL_MS || 300_000));
const concurrency = Math.max(1, Math.min(8, Number(process.env.DISK_USAGE_COLLECTION_CONCURRENCY || 2)));
const redisTtlSeconds = Math.max(180, Math.ceil(intervalMs / 1000) * 3);
const localCacheMs = Math.max(15_000, Number(process.env.DISK_USAGE_LOCAL_CACHE_MS || 60_000));

function redisKey(serverId) {
  return `ragenodes:disk-usage:${serverId}`;
}

function normalizeSample(sample) {
  const bytes = Math.max(0, Number(sample?.bytes || 0));
  const updatedAt = Math.max(0, Number(sample?.updatedAt || 0));
  return { bytes, updatedAt };
}

export function cacheDiskUsageSample(serverId, sample) {
  const normalized = normalizeSample(sample);
  DISK_USAGE_CACHE.set(String(serverId), { ...normalized, cachedAt: Date.now() });
  return normalized;
}

export function clearDiskUsageCache() {
  DISK_USAGE_CACHE.clear();
}

export async function getCachedDiskUsage(serverId) {
  const key = String(serverId);
  const local = DISK_USAGE_CACHE.get(key);
  if (local && Date.now() - local.cachedAt < localCacheMs) {
    return { bytes: local.bytes, updatedAt: local.updatedAt, pending: false };
  }

  if (!redisClient?.isOpen) {
    try {
      await promiseWithTimeout(ensureRedis(), 300, 'Redis disk-usage connection timeout');
    } catch {
      // The HTTP read remains bounded and falls back to a pending sample.
    }
  }

  if (redisClient?.isOpen) {
    try {
      const raw = await promiseWithTimeout(
        redisClient.get(redisKey(key)),
        300,
        'Redis disk-usage cache timeout'
      );
      if (raw) return { ...cacheDiskUsageSample(key, JSON.parse(raw)), pending: false };
    } catch (error) {
      console.warn(`[DiskUsage] No se pudo leer la caché de ${key}: ${error.message}`);
    }
  }

  // A cache miss must never turn a customer read into a recursive filesystem
  // walk. The stats worker will populate the sample independently.
  return { bytes: 0, updatedAt: 0, pending: true };
}

export async function collectDiskUsageSample(server) {
  if (!server?.id || !server?.data_path) return null;
  const sample = cacheDiskUsageSample(server.id, {
    bytes: await getFolderSize(server.data_path),
    updatedAt: Date.now()
  });
  if (!redisClient?.isOpen) {
    await ensureRedis();
  }
  if (redisClient?.isOpen) {
    try {
      await promiseWithTimeout(
        redisClient.setEx(redisKey(server.id), redisTtlSeconds, JSON.stringify(sample)),
        1_000,
        'Redis disk-usage cache write timeout'
      );
    } catch (error) {
      console.warn(`[DiskUsage] Muestra local conservada; Redis no respondió para ${server.id}: ${error.message}`);
    }
  }
  return sample;
}

export async function collectDiskUsage() {
  const servers = (await listAllServers()).filter(server => server.id && server.data_path);
  let collected = 0;
  for (let offset = 0; offset < servers.length; offset += concurrency) {
    const batch = servers.slice(offset, offset + concurrency);
    const results = await Promise.allSettled(batch.map(collectDiskUsageSample));
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (result.status === 'fulfilled' && result.value) {
        collected += 1;
      } else if (result.status === 'rejected') {
        console.warn(`[DiskUsage] No se pudo medir ${batch[index].id}: ${result.reason?.message || result.reason}`);
      }
    }
  }
  return collected;
}

export function startDiskUsageCollector() {
  console.log(`[DiskUsage] Recolección en segundo plano cada ${Math.round(intervalMs / 1000)}s (concurrencia ${concurrency}).`);
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await collectDiskUsage();
    } catch (error) {
      console.error(`[DiskUsage] Error en el recolector: ${error.message}`);
    } finally {
      running = false;
    }
  };
  void run();
  return setInterval(run, intervalMs);
}

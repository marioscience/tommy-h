import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { query } from '../db.js';

const cacheDir = '/app/config-gateway/static';
const serverRefreshMs = Math.max(30000, Number(process.env.QUERY_WARMER_SERVER_REFRESH_MS || 60000));
const minimumCycleMs = Math.max(3000, Number(process.env.QUERY_WARMER_MIN_CYCLE_MS || 5000));
const maximumCycleMs = Math.max(minimumCycleMs, Number(process.env.QUERY_WARMER_MAX_CYCLE_MS || 30000));

function contentHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function startQueryWarmer() {
  console.log('🔥 [QueryWarmer] Caché FiveM con escrituras por cambio.');
  const knownHashes = new Map();
  let servers = [];
  let refreshedAt = 0;

  const refreshServers = async () => {
    if (Date.now() - refreshedAt < serverRefreshMs) return;
    const result = await query(
      "SELECT id, fivem_port FROM servers WHERE status = 'running' AND template = 'fivem'"
    );
    servers = result.rows;
    refreshedAt = Date.now();
  };

  const warmServer = async (server) => {
    const internalPort = Number(server.fivem_port) + 20000;
    const serverDir = path.join(cacheDir, String(server.fivem_port));
    await fs.mkdir(serverDir, { recursive: true });
    await Promise.all(['info.json', 'players.json', 'dynamic.json'].map(async (file) => {
      try {
        const response = await axios.get(`http://172.17.0.1:${internalPort}/${file}`, { timeout: 1500 });
        if (response.status !== 200) return;
        const content = JSON.stringify(response.data);
        const key = `${server.id}:${file}`;
        const hash = contentHash(content);
        if (knownHashes.get(key) === hash) return;
        await fs.writeFile(path.join(serverDir, file), content);
        knownHashes.set(key, hash);
      } catch {
        // Un servidor que arranca o se detiene no debe interrumpir el lote.
      }
    }));
  };

  const runCycle = async () => {
    try {
      await refreshServers();
      for (let index = 0; index < servers.length; index += 15) {
        await Promise.all(servers.slice(index, index + 15).map(warmServer));
      }
    } catch (error) {
      console.warn('[QueryWarmer] Ciclo omitido:', error.message);
      refreshedAt = 0;
    } finally {
      const loadDelay = minimumCycleMs * Math.max(1, Math.ceil(servers.length / 100));
      setTimeout(runCycle, Math.min(maximumCycleMs, loadDelay));
    }
  };

  void runCycle();
}

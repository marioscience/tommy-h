import { query } from '../db.js';
import * as serverService from './serverService.js';
import { getContainerStats } from './dockerService.js';
import { checkServerAlerts } from './alertService.js';

const intervalMs = Math.max(60000, Number(process.env.STATS_HISTORY_INTERVAL_MS || 300000));

export async function collectHistoricalStats() {
  const servers = (await serverService.getAllServers()).filter((server) => server.status === 'running');
  const samples = [];
  await Promise.all(servers.map(async (server) => {
    try {
      const stats = await getContainerStats(server.container_name);
      if (stats?.cpu === undefined) return;
      samples.push({
        id: server.id,
        cpu: Number.parseFloat(stats.cpu),
        ram: Number.parseFloat(stats.ram),
        ramGb: Number.parseFloat(stats.ramGb)
      });
      await checkServerAlerts(server, stats);
    } catch (error) {
      console.error(`❌ Error recolectando stats para ${server.name}:`, error.message);
    }
  }));

  if (samples.length === 0) return 0;
  await query(
    `INSERT INTO server_stats_history (server_id, cpu, ram, ram_gb)
     SELECT * FROM UNNEST($1::uuid[], $2::real[], $3::real[], $4::real[])`,
    [
      samples.map((sample) => sample.id),
      samples.map((sample) => sample.cpu),
      samples.map((sample) => sample.ram),
      samples.map((sample) => sample.ramGb)
    ]
  );
  return samples.length;
}

export function startStatsCollector() {
  console.log(`📈 [StatsCollector] Historial por lotes cada ${Math.round(intervalMs / 1000)}s.`);
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await collectHistoricalStats();
    } catch (error) {
      console.error('❌ [StatsCollector] Error recolectando estadísticas:', error);
    } finally {
      running = false;
    }
  };
  void run();
  return setInterval(run, intervalMs);
}

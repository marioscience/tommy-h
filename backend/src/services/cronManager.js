import { withTransaction } from '../db.js';
import { controlServer } from './serverService.js';
import { sendCommandToContainer } from './dockerService.js';

async function claimDueJobs(timeString, runKey, limit = 50) {
  return withTransaction(async (tx) => {
    const result = await tx(
      `WITH due AS (
         SELECT j.id, s.container_name FROM server_cron_jobs j JOIN servers s ON s.id = j.server_id
         WHERE j.is_active = TRUE AND j.time_hh_mm = $1 AND s.status = 'running'
           AND j.last_run_key IS DISTINCT FROM $2
         ORDER BY j.id FOR UPDATE OF j SKIP LOCKED LIMIT $3
       ) UPDATE server_cron_jobs j SET last_run_key = $2, last_run_at = NOW()
       FROM due WHERE j.id = due.id RETURNING j.id, j.server_id, j.action, j.payload, due.container_name`,
      [timeString, runKey, limit]
    );
    return result.rows;
  });
}

export async function runDueCronJobs(now = new Date()) {
  const timeString = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const runKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${timeString}`;
  const jobs = await claimDueJobs(timeString, runKey);
  for (const job of jobs) {
    try {
      if (job.action === 'command' && job.payload) await sendCommandToContainer(job.container_name, job.payload);
      else if (['restart', 'stop', 'start'].includes(job.action)) await controlServer(job.server_id, null, job.action, true);
    } catch (error) {
      console.error(`❌ [Cron] Error ejecutando tarea ${job.id}:`, error.message);
    }
  }
  return jobs.length;
}

export function startCronManager() {
  console.log('🕒 [Cron] Gestor idempotente de tareas iniciado.');
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runDueCronJobs(); }
    catch (error) { console.error('❌ [Cron] Error general:', error.message); }
    finally { running = false; }
  };
  void tick();
  return setInterval(tick, 60_000);
}

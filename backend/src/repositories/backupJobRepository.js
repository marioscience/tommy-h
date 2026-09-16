import { query, withTransaction } from '../db.js';

const priorityForPlan = (plan) => {
  const value = String(plan || '').toLowerCase();
  if (value === 'partner') return 120;
  if (['platinum', 'elite', 'premium'].includes(value)) return 100;
  if (value === 'standard') return 50;
  return 10;
};

const publicJob = (row) => row && ({
  jobId: row.id, serverId: row.server_id,
  status: row.status === 'running' ? 'processing' : row.status,
  plan: row.plan, queuePosition: Number(row.queue_position || 0),
  addedAt: row.created_at, startedAt: row.claimed_at,
  finishedAt: row.completed_at, result: row.result, error: row.last_error
});

export async function enqueueBackup(serverId, requesterId, isAdmin, customName, plan = 'hobby') {
  try {
    const result = await query(
      `INSERT INTO backup_jobs (server_id, requester_id, requested_by_admin, custom_name, plan, priority)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [serverId, requesterId || null, Boolean(isAdmin), customName || null, plan, priorityForPlan(plan)]
    );
    return publicJob(result.rows[0]);
  } catch (error) {
    if (error?.code !== '23505') throw error;
    const existing = await query(
      `SELECT *, 0 AS queue_position FROM backup_jobs
       WHERE server_id = $1 AND status IN ('queued', 'running') ORDER BY created_at LIMIT 1`, [serverId]
    );
    if (!existing.rowCount) throw error;
    return publicJob(existing.rows[0]);
  }
}

export async function getBackupJob(jobId, requesterId, isAdmin = false) {
  const result = await query(
    `SELECT j.*, CASE WHEN j.status = 'queued' THEN (
       SELECT COUNT(*) FROM backup_jobs q WHERE q.status = 'queued'
       AND (q.priority > j.priority OR (q.priority = j.priority AND q.created_at <= j.created_at))
     ) ELSE 0 END AS queue_position
     FROM backup_jobs j WHERE j.id = $1 AND ($2::boolean OR j.requester_id = $3)`,
    [jobId, Boolean(isAdmin), requesterId || null]
  );
  return publicJob(result.rows[0]);
}

export async function recoverStaleBackups(staleMinutes = 120) {
  return query(
    `UPDATE backup_jobs SET status = 'queued', claimed_at = NULL, claimed_by = NULL,
       available_at = NOW(), updated_at = NOW(), last_error = 'Recovered after worker interruption'
     WHERE status = 'running' AND claimed_at < NOW() - ($1::text || ' minutes')::interval`,
    [Math.max(1, Number(staleMinutes))]
  );
}

export async function claimNextBackup(workerId) {
  return withTransaction(async (tx) => {
    const result = await tx(
      `WITH candidate AS (
         SELECT id FROM backup_jobs WHERE status = 'queued' AND available_at <= NOW() AND attempts < max_attempts
         ORDER BY priority DESC, created_at FOR UPDATE SKIP LOCKED LIMIT 1
       ) UPDATE backup_jobs j SET status = 'running', attempts = attempts + 1,
         claimed_at = NOW(), claimed_by = $1, updated_at = NOW()
       FROM candidate WHERE j.id = candidate.id RETURNING j.*`, [workerId]
    );
    return result.rows[0] || null;
  });
}

export async function completeBackup(id, result) {
  await query(`UPDATE backup_jobs SET status = 'completed', result = $2, completed_at = NOW(), updated_at = NOW(), last_error = NULL WHERE id = $1`, [id, JSON.stringify(result ?? null)]);
}

export async function failBackup(job, error) {
  const status = Number(job.attempts) < Number(job.max_attempts) ? 'queued' : 'failed';
  await query(
    `UPDATE backup_jobs SET status = $2, last_error = $3, claimed_at = NULL, claimed_by = NULL,
       available_at = CASE WHEN $2 = 'queued' THEN NOW() + (LEAST(300, 15 * POWER(2, attempts - 1))::text || ' seconds')::interval ELSE available_at END,
       completed_at = CASE WHEN $2 = 'failed' THEN NOW() ELSE NULL END, updated_at = NOW() WHERE id = $1`,
    [job.id, status, String(error?.message || error || 'Backup failed').slice(0, 2000)]
  );
}

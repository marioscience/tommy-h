import { query, withTransaction } from '../db.js';
import { decryptDeploymentSecret, encryptDeploymentSecret } from '../services/deploymentPayloadCrypto.js';

const RETRY_BASE_SECONDS = Math.max(1, Number(process.env.DEPLOYMENT_RETRY_BASE_SECONDS || 15));

function positiveLimit(value, fallback, maximum = 1024) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export async function enqueueDeployment(ownerId, idempotencyKey, payload, optionsOrDb = {}, db = query) {
  const options = typeof optionsOrDb === 'function' ? {} : optionsOrDb;
  const execute = typeof optionsOrDb === 'function' ? optionsOrDb : db;
  const safePayload = { ...payload };
  const secretCiphertext = encryptDeploymentSecret(safePayload.licenseKey);
  delete safePayload.licenseKey;
  const result = await execute(
    `INSERT INTO deployment_jobs (
       owner_id, idempotency_key, payload, secret_ciphertext, node_id,
       requested_ram_gb, requested_disk_gb, workload_class, phase
     )
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, 'queued')
     ON CONFLICT (owner_id, idempotency_key) DO UPDATE
       SET idempotency_key = EXCLUDED.idempotency_key
     RETURNING *`,
    [ownerId, idempotencyKey, JSON.stringify(safePayload), secretCiphertext,
      options.nodeId ?? null, options.requestedRamGb ?? null,
      options.requestedDiskGb ?? null, options.workloadClass || 'standard']
  );
  return result.rows[0];
}

/** Atomically leases one ready job; concurrent workers cannot claim the same row. */
export async function claimDeployment(workerId, optionsOrTransaction = {}, transaction = withTransaction) {
  const options = typeof optionsOrTransaction === 'function' ? {} : optionsOrTransaction;
  const runTransaction = typeof optionsOrTransaction === 'function' ? optionsOrTransaction : transaction;
  const nodeId = options.nodeId === undefined || options.nodeId === null || options.nodeId === ''
    ? null : Number(options.nodeId);
  const standardSlots = positiveLimit(options.standardSlots || process.env.DEPLOYMENT_STANDARD_SLOTS, 4, 64);
  const heavySlots = positiveLimit(options.heavySlots || process.env.DEPLOYMENT_HEAVY_SLOTS, 1, 16);
  const lightSlots = positiveLimit(options.lightSlots || process.env.DEPLOYMENT_LIGHT_SLOTS, 8, 64);
  const nodeSlots = positiveLimit(options.nodeSlots || process.env.DEPLOYMENT_NODE_SLOTS, 4, 64);
  const globalSlots = positiveLimit(options.globalSlots || process.env.DEPLOYMENT_GLOBAL_SLOTS, 32, 1024);
  return runTransaction(async (tx) => {
    const result = await tx(
      `WITH candidates AS (
         SELECT id, node_id, workload_class, created_at
         FROM deployment_jobs
         WHERE status = 'queued' AND available_at <= NOW()
           AND ($2::integer IS NULL OR node_id = $2)
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 32
       ), leased AS (
         SELECT candidate.id, slot.slot
         FROM candidates candidate
         CROSS JOIN LATERAL generate_series(
           1, CASE candidate.workload_class
             WHEN 'io_heavy' THEN $3::integer
             WHEN 'light' THEN $5::integer
             ELSE $4::integer END
         ) slot(slot)
         WHERE NOT EXISTS (
           SELECT 1 FROM deployment_worker_leases active
           WHERE active.node_id = candidate.node_id
             AND active.workload_class = candidate.workload_class
             AND active.slot = slot.slot
         )
           AND (SELECT COUNT(*) FROM deployment_worker_leases active
                WHERE active.node_id = candidate.node_id) < $6::integer
           AND (SELECT COUNT(*) FROM deployment_worker_leases) < $7::integer
         ORDER BY candidate.created_at, slot.slot
         LIMIT 1
       ), lease AS (
         INSERT INTO deployment_worker_leases
           (job_id, node_id, workload_class, slot, worker_id)
         SELECT job.id, job.node_id, job.workload_class, leased.slot, $1
         FROM leased JOIN deployment_jobs job ON job.id = leased.id
         ON CONFLICT DO NOTHING
         RETURNING job_id
       )
       UPDATE deployment_jobs AS job
       SET status = 'running', phase = 'preparing', claimed_at = NOW(), claimed_by = $1,
           started_at = COALESCE(started_at, NOW()), attempts = attempts + 1, updated_at = NOW()
       FROM lease
       WHERE job.id = lease.job_id
       RETURNING job.*`,
      [workerId, nodeId, heavySlots, standardSlots, lightSlots, nodeSlots, globalSlots]
    );
    const job = result.rows[0] || null;
    if (job?.secret_ciphertext) {
      job.payload = { ...job.payload, licenseKey: decryptDeploymentSecret(job.secret_ciphertext) };
      delete job.secret_ciphertext;
    }
    return job;
  });
}

export async function completeDeployment(jobId, serverId, db = query) {
  const result = await db(
    `WITH released AS (DELETE FROM deployment_worker_leases WHERE job_id = $1),
          released_ports AS (DELETE FROM deployment_port_reservations WHERE job_id = $1)
     UPDATE deployment_jobs
     SET status = 'succeeded', phase = 'ready', server_id = $2, completed_at = NOW(),
         claimed_at = NULL, claimed_by = NULL, last_error = NULL, updated_at = NOW()
     WHERE id = $1 AND status = 'running'
     RETURNING *`,
    [jobId, serverId]
  );
  return result.rows[0] || null;
}

export async function failDeployment(jobId, errorMessage, db = query) {
  const result = await db(
    `WITH released AS (DELETE FROM deployment_worker_leases WHERE job_id = $1),
          released_ports AS (
            DELETE FROM deployment_port_reservations
            WHERE job_id = $1 AND EXISTS (
              SELECT 1 FROM deployment_jobs WHERE id = $1 AND attempts >= max_attempts
            )
          )
     UPDATE deployment_jobs
     SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
         phase = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
         available_at = CASE
           WHEN attempts >= max_attempts THEN available_at
           ELSE NOW() + ($2 * POWER(2, GREATEST(attempts - 1, 0))) * INTERVAL '1 second'
         END,
         completed_at = CASE WHEN attempts >= max_attempts THEN NOW() ELSE NULL END,
         claimed_at = NULL, claimed_by = NULL, last_error = $3, updated_at = NOW()
     WHERE id = $1 AND status = 'running'
     RETURNING *`,
    [jobId, RETRY_BASE_SECONDS, String(errorMessage || 'Error de despliegue').slice(0, 1000)]
  );
  return result.rows[0] || null;
}

export async function recoverStaleDeployments(timeoutMinutes = 30, db = query) {
  const safeTimeout = Math.max(1, Math.min(240, Number(timeoutMinutes) || 30));
  return db(
    `WITH stale AS (
       SELECT id FROM deployment_jobs
       WHERE status = 'running' AND claimed_at < NOW() - ($1 * INTERVAL '1 minute')
     ), released AS (
       DELETE FROM deployment_worker_leases WHERE job_id IN (SELECT id FROM stale)
     )
     UPDATE deployment_jobs
     SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
         phase = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
         available_at = NOW(), claimed_at = NULL, claimed_by = NULL,
         completed_at = CASE WHEN attempts >= max_attempts THEN NOW() ELSE NULL END,
         last_error = COALESCE(last_error, 'Worker interrumpido; trabajo recuperado'),
         updated_at = NOW()
     WHERE id IN (SELECT id FROM stale)
     RETURNING id, status`,
    [safeTimeout]
  );
}

export async function getDeploymentForOwner(jobId, ownerId, isAdmin = false, db = query) {
  const result = await db(
    `SELECT job.id, job.owner_id, job.server_id, job.status, job.phase,
            job.node_id, job.workload_class, job.attempts, job.max_attempts,
            job.available_at, job.started_at, job.completed_at, job.last_error,
            job.created_at, job.updated_at,
            CASE WHEN job.status = 'queued' THEN 1 + (
              SELECT COUNT(*) FROM deployment_jobs ahead
              WHERE ahead.status = 'queued' AND ahead.node_id = job.node_id
                AND ahead.created_at < job.created_at
            ) ELSE 0 END::integer AS queue_position,
            (SELECT COUNT(*) FROM deployment_jobs queued
             WHERE queued.status = 'queued' AND queued.node_id = job.node_id)::integer AS queue_depth,
            CASE WHEN job.status = 'queued' THEN CEIL(COALESCE((
              SELECT AVG(EXTRACT(EPOCH FROM (done.completed_at - done.started_at)))
              FROM deployment_jobs done
              WHERE done.status = 'succeeded' AND done.workload_class = job.workload_class
                AND done.started_at IS NOT NULL AND done.completed_at IS NOT NULL
            ), 30) * GREATEST(0, (SELECT COUNT(*) FROM deployment_jobs ahead
              WHERE ahead.status = 'queued' AND ahead.node_id = job.node_id
                AND ahead.created_at < job.created_at)))::integer ELSE 0 END AS estimated_wait_seconds
     FROM deployment_jobs job
     WHERE job.id = $1 AND ($2::boolean OR job.owner_id = $3)`,
    [jobId, Boolean(isAdmin), ownerId]
  );
  return result.rows[0] || null;
}

export async function getDeploymentQueueMetrics(db = query) {
  const result = await db(`
    SELECT node_id, workload_class,
      COUNT(*) FILTER (WHERE status = 'queued')::integer AS queue_depth,
      COUNT(*) FILTER (WHERE status = 'running')::integer AS running,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (started_at - created_at)))
        FILTER (WHERE started_at IS NOT NULL) AS wait_p95_seconds,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (started_at - created_at)))
        FILTER (WHERE started_at IS NOT NULL) AS wait_p99_seconds
    FROM deployment_jobs
    WHERE created_at > NOW() - INTERVAL '24 hours'
    GROUP BY node_id, workload_class
    ORDER BY node_id, workload_class
  `);
  return result.rows;
}

export async function updateDeploymentPhase(jobId, phase, db = query) {
  const allowed = new Set(['queued', 'preparing', 'starting', 'ready', 'failed']);
  if (!allowed.has(phase)) throw new Error(`Fase de despliegue no valida: ${phase}`);
  await db('UPDATE deployment_jobs SET phase = $2, updated_at = NOW() WHERE id = $1', [jobId, phase]);
}

import { query, withTransaction } from '../db.js';
import { decryptDeploymentSecret, encryptDeploymentSecret } from '../services/deploymentPayloadCrypto.js';

const RETRY_BASE_SECONDS = Math.max(1, Number(process.env.DEPLOYMENT_RETRY_BASE_SECONDS || 15));

export async function enqueueDeployment(ownerId, idempotencyKey, payload, db = query) {
  const safePayload = { ...payload };
  const secretCiphertext = encryptDeploymentSecret(safePayload.licenseKey);
  delete safePayload.licenseKey;
  const result = await db(
    `INSERT INTO deployment_jobs (owner_id, idempotency_key, payload, secret_ciphertext)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (owner_id, idempotency_key) DO UPDATE
       SET idempotency_key = EXCLUDED.idempotency_key
     RETURNING *`,
    [ownerId, idempotencyKey, JSON.stringify(safePayload), secretCiphertext]
  );
  return result.rows[0];
}

/** Atomically leases one ready job; concurrent workers cannot claim the same row. */
export async function claimDeployment(workerId, transaction = withTransaction) {
  return transaction(async (tx) => {
    const result = await tx(
      `WITH candidate AS (
         SELECT id
         FROM deployment_jobs
         WHERE status = 'queued' AND available_at <= NOW()
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE deployment_jobs AS job
       SET status = 'running', claimed_at = NOW(), claimed_by = $1,
           attempts = attempts + 1, updated_at = NOW()
       FROM candidate
       WHERE job.id = candidate.id
       RETURNING job.*`,
      [workerId]
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
    `UPDATE deployment_jobs
     SET status = 'succeeded', server_id = $2, completed_at = NOW(),
         claimed_at = NULL, claimed_by = NULL, last_error = NULL, updated_at = NOW()
     WHERE id = $1 AND status = 'running'
     RETURNING *`,
    [jobId, serverId]
  );
  return result.rows[0] || null;
}

export async function failDeployment(jobId, errorMessage, db = query) {
  const result = await db(
    `UPDATE deployment_jobs
     SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
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
    `UPDATE deployment_jobs
     SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
         available_at = NOW(), claimed_at = NULL, claimed_by = NULL,
         completed_at = CASE WHEN attempts >= max_attempts THEN NOW() ELSE NULL END,
         last_error = COALESCE(last_error, 'Worker interrumpido; trabajo recuperado'),
         updated_at = NOW()
     WHERE status = 'running'
       AND claimed_at < NOW() - ($1 * INTERVAL '1 minute')
     RETURNING id, status`,
    [safeTimeout]
  );
}

export async function getDeploymentForOwner(jobId, ownerId, isAdmin = false, db = query) {
  const result = await db(
    `SELECT id, owner_id, server_id, status, attempts, max_attempts,
            available_at, completed_at, last_error, created_at, updated_at
     FROM deployment_jobs
     WHERE id = $1 AND ($2::boolean OR owner_id = $3)`,
    [jobId, Boolean(isAdmin), ownerId]
  );
  return result.rows[0] || null;
}

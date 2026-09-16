import os from 'node:os';
import { createFullBackup } from './backupService.js';
import { claimNextBackup, completeBackup, failBackup, recoverStaleBackups } from '../repositories/backupJobRepository.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startBackupWorker({ signal } = {}) {
  const workerId = `${os.hostname()}:${process.pid}`;
  await recoverStaleBackups(Number(process.env.BACKUP_STALE_MINUTES || 120));
  let idleMs = 1000;
  console.log(`[BackupWorker] Cola PostgreSQL activa como ${workerId}.`);
  while (!signal?.aborted) {
    const job = await claimNextBackup(workerId);
    if (!job) {
      await sleep(idleMs);
      idleMs = Math.min(15000, Math.round(idleMs * 1.5));
      continue;
    }
    idleMs = 1000;
    try {
      const result = await createFullBackup(job.server_id, job.requester_id, job.requested_by_admin, job.custom_name);
      await completeBackup(job.id, result);
    } catch (error) {
      console.error(`[BackupWorker] Falló ${job.id}:`, error.message);
      await failBackup(job, error);
    }
  }
}

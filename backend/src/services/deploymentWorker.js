import os from 'os';
import { createServerForUser } from './serverCreationService.js';
import {
  claimDeployment,
  completeDeployment,
  failDeployment,
  recoverStaleDeployments
} from '../repositories/deploymentJobRepository.js';

const minimumPollMs = Math.max(500, Number(process.env.DEPLOYMENT_POLL_INTERVAL_MS || 1500));
const maximumPollMs = Math.max(minimumPollMs, Number(process.env.DEPLOYMENT_MAX_IDLE_POLL_MS || 30000));
const staleMinutes = Math.max(5, Number(process.env.DEPLOYMENT_STALE_MINUTES || 45));

export async function processNextDeployment(workerId) {
  const job = await claimDeployment(workerId);
  if (!job) return false;

  try {
    const server = await createServerForUser(job.owner_id, job.payload);
    await completeDeployment(job.id, server.id);
  } catch (error) {
    console.error(`[DeploymentWorker] Falló ${job.id}:`, error);
    await failDeployment(job.id, error?.message);
  }
  return true;
}

/** Runs one job at a time per process; scale workers only within node capacity. */
export async function startDeploymentWorker() {
  const workerId = `${os.hostname()}:${process.pid}`;
  const recovered = await recoverStaleDeployments(staleMinutes);
  if (recovered.rowCount > 0) {
    console.warn(`[DeploymentWorker] Recuperados ${recovered.rowCount} trabajos abandonados.`);
  }

  let stopped = false;
  const stop = () => { stopped = true; };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  let idleDelayMs = minimumPollMs;
  while (!stopped) {
    const processed = await processNextDeployment(workerId);
    if (processed) {
      idleDelayMs = minimumPollMs;
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, idleDelayMs));
    idleDelayMs = Math.min(maximumPollMs, Math.ceil(idleDelayMs * 1.75));
  }
}

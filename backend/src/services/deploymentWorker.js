import os from 'os';
import { createServerForUser } from './serverCreationService.js';
import {
  claimDeployment,
  completeDeployment,
  failDeployment,
  recoverStaleDeployments,
  updateDeploymentPhase
} from '../repositories/deploymentJobRepository.js';

const minimumPollMs = Math.max(500, Number(process.env.DEPLOYMENT_POLL_INTERVAL_MS || 1500));
const maximumPollMs = Math.max(minimumPollMs, Number(process.env.DEPLOYMENT_MAX_IDLE_POLL_MS || 30000));
const staleMinutes = Math.max(5, Number(process.env.DEPLOYMENT_STALE_MINUTES || 45));

export async function processNextDeployment(workerId, options = {}) {
  const job = await claimDeployment(workerId, options);
  if (!job) return false;

  try {
    if (job.server_id) {
      await completeDeployment(job.id, job.server_id);
      return true;
    }
    await updateDeploymentPhase(job.id, 'starting');
    const server = await createServerForUser(job.owner_id, {
      ...job.payload, nodeId: job.node_id, deploymentJobId: job.id
    });
    await completeDeployment(job.id, server.id);
  } catch (error) {
    console.error(`[DeploymentWorker] Falló ${job.id}:`, error);
    await failDeployment(job.id, error?.message);
  }
  return true;
}

/** Runs bounded local slots; database leases enforce class, node and global capacity. */
export async function startDeploymentWorker() {
  const workerId = `${os.hostname()}:${process.pid}`;
  const configuredNode = process.env.DEPLOYMENT_NODE_ID;
  const nodeId = configuredNode === undefined || configuredNode === '' ? null : Number(configuredNode);
  if (nodeId !== null && (!Number.isInteger(nodeId) || nodeId < 0)) {
    throw new Error('DEPLOYMENT_NODE_ID debe ser un entero positivo o cero.');
  }
  const requestedConcurrency = Number(process.env.DEPLOYMENT_WORKER_CONCURRENCY || 1);
  const concurrency = Number.isInteger(requestedConcurrency) && requestedConcurrency > 0
    ? Math.min(16, requestedConcurrency) : 1;
  const recovered = await recoverStaleDeployments(staleMinutes);
  if (recovered.rowCount > 0) {
    console.warn(`[DeploymentWorker] Recuperados ${recovered.rowCount} trabajos abandonados.`);
  }

  let stopped = false;
  const stop = () => { stopped = true; };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  const runSlot = async (slot) => {
    let idleDelayMs = minimumPollMs;
    while (!stopped) {
      const processed = await processNextDeployment(`${workerId}:${slot}`, { nodeId });
      if (processed) {
        idleDelayMs = minimumPollMs;
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, idleDelayMs));
      idleDelayMs = Math.min(maximumPollMs, Math.ceil(idleDelayMs * 1.75));
    }
  };
  await Promise.all(Array.from({ length: concurrency }, (_, slot) => runSlot(slot + 1)));
}

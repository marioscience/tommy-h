import { query, withTransaction } from '../db.js';
import { config } from '../config.js';
import {
  getEffectiveServerLimit,
  getPlanRamGb,
  isTemplateAllowed,
  normalizeTemplateKey,
  resolveRequestedRamGb,
  resolveServerPlan,
  getPortAllocationPolicy
} from './serverPlanPolicy.js';
import {
  getHealthyDeploymentNodeIds,
  getNextAvailablePort,
  selectDeploymentNode
} from './serverNodeSelection.js';
import { enqueueDeployment } from '../repositories/deploymentJobRepository.js';

const DISK_ESTIMATES_GB = Object.freeze({
  ark: 80, rust: 25, sdtd: 18, cs2: 40, palworld: 15,
  fivem: 8, minecraft: 5, zomboid: 8, valheim: 3,
  wordpress: 2, database: 2, discordbot: 1
});

function positiveLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function classifyDeploymentWorkload(template) {
  const key = normalizeTemplateKey(template);
  if (['ark', 'rust', 'sdtd', 'cs2', 'palworld'].includes(key)) return 'io_heavy';
  if (['wordpress', 'database', 'discordbot'].includes(key)) return 'light';
  return 'standard';
}

export function estimateDeploymentDiskGb(template) {
  return DISK_ESTIMATES_GB[normalizeTemplateKey(template)] || 10;
}

/** Serializes placement briefly so simultaneous requests see committed reservations. */
async function planInsideTransaction(ownerId, payload, tx, healthyNodeIds) {
    await tx('SELECT pg_advisory_xact_lock($1)', [74192026]);
    const userResult = await tx(
      'SELECT plan, server_limit, extra_disk_gb FROM users WHERE id = $1 FOR UPDATE',
      [ownerId]
    );
    if (!userResult.rows[0]) throw new Error('Usuario no encontrado.');

    const user = userResult.rows[0];
    const { key: assignedPlan, plan } = resolveServerPlan(user.plan);
    const template = normalizeTemplateKey(payload.template || 'fivem');
    if (!isTemplateAllowed(plan, template)) {
      throw new Error(`Tu plan actual (${assignedPlan.toUpperCase()}) no permite servidores de ${template.toUpperCase()}.`);
    }
    const servers = await tx(
      `SELECT runtime_plan, allocated_ram_gb FROM servers
       WHERE owner_id = $1 AND status <> 'deleted'`,
      [ownerId]
    );
    const activeJobs = await tx(
      `SELECT requested_ram_gb FROM deployment_jobs
       WHERE owner_id = $1 AND status IN ('queued', 'running')`,
      [ownerId]
    );
    const limit = getEffectiveServerLimit(user.server_limit, plan, config.serverLimitPerUser);
    if (servers.rows.length + activeJobs.rows.length >= limit) {
      throw new Error(`Limite alcanzado: tu plan (${assignedPlan.toUpperCase()}) permite ${limit} servidor(es).`);
    }
    const usedRam = [...servers.rows, ...activeJobs.rows].reduce((total, item) => {
      const allocated = Number(item.allocated_ram_gb ?? item.requested_ram_gb);
      return total + (Number.isFinite(allocated) && allocated > 0
        ? allocated
        : getPlanRamGb(resolveServerPlan(item.runtime_plan).plan));
    }, 0);
    const requestedRamGb = resolveRequestedRamGb(payload.allocatedRamGb, plan, template);
    if (usedRam + requestedRamGb > getPlanRamGb(plan)) {
      throw new Error(`Recursos insuficientes: tienes ${usedRam} GB reservados y solicitas ${requestedRamGb} GB.`);
    }
    if (template === 'cs2' && assignedPlan === 'standard' && Number(user.extra_disk_gb || 0) <= 30) {
      throw new Error('El plan STANDARD requiere una expansion de disco superior a 30 GB para desplegar CS2.');
    }
    const node = await selectDeploymentNode(
      { ...plan, memoryBytes: requestedRamGb * 1024 ** 3 },
      requestedRamGb,
      template,
      payload.nodeId ?? payload.explicitNodeId,
      0,
      healthyNodeIds
    );
    return {
      payload: {
        ...payload, template, allocatedRamGb: requestedRamGb,
        nodeId: Number(node.id), capacityReserved: true
      },
      nodeId: Number(node.id),
      requestedRamGb,
      requestedDiskGb: estimateDeploymentDiskGb(template),
      workloadClass: classifyDeploymentWorkload(template)
    };
}

export async function planDeployment(ownerId, payload = {}, transaction = withTransaction) {
  const healthyNodeIds = await getHealthyDeploymentNodeIds();
  return transaction((tx) => planInsideTransaction(ownerId, payload, tx, healthyNodeIds));
}

/** Placement and reservation commit atomically under the placement lock. */
export async function planAndEnqueueDeployment(ownerId, idempotencyKey, payload = {}, transaction = withTransaction) {
  const healthyNodeIds = await getHealthyDeploymentNodeIds();
  return transaction(async (tx) => {
    const existing = await tx(
      `SELECT * FROM deployment_jobs WHERE owner_id = $1 AND idempotency_key = $2`,
      [ownerId, idempotencyKey]
    );
    if (existing.rows[0]) {
      return { job: existing.rows[0], plan: { nodeId: existing.rows[0].node_id } };
    }
    const globalLimit = positiveLimit(process.env.DEPLOYMENT_MAX_QUEUED_GLOBAL, 1000);
    const globalDepth = await tx(
      `SELECT COUNT(*)::integer AS count FROM deployment_jobs WHERE status = 'queued'`
    );
    if (Number(globalDepth.rows[0]?.count || 0) >= globalLimit) {
      throw new Error('La cola global de despliegues alcanzó temporalmente su límite. Inténtalo más tarde.');
    }
    const plan = await planInsideTransaction(ownerId, payload, tx, healthyNodeIds);
    const nodeLimit = positiveLimit(process.env.DEPLOYMENT_MAX_QUEUED_PER_NODE, 200);
    const nodeDepth = await tx(
      `SELECT COUNT(*)::integer AS count FROM deployment_jobs
       WHERE node_id = $1 AND status = 'queued'`,
      [plan.nodeId]
    );
    if (Number(nodeDepth.rows[0]?.count || 0) >= nodeLimit) {
      throw new Error('El nodo seleccionado tiene demasiados despliegues en cola. Inténtalo más tarde.');
    }
    const storage = await tx(
      `SELECT telemetry.disk_total_bytes - telemetry.disk_used_bytes AS free_bytes,
              COALESCE((SELECT SUM(requested_disk_gb) FROM deployment_jobs
                WHERE node_id = $1 AND status IN ('queued', 'running')), 0) AS reserved_gb
       FROM node_telemetry telemetry
       WHERE telemetry.node_id = $1
       ORDER BY telemetry.recorded_at DESC LIMIT 1`,
      [plan.nodeId]
    );
    if (storage.rows[0]) {
      const freeGb = Number(storage.rows[0].free_bytes) / (1024 ** 3);
      const availableGb = freeGb - Number(storage.rows[0].reserved_gb || 0);
      if (availableGb < plan.requestedDiskGb) {
        throw new Error(`El nodo no tiene almacenamiento reservable suficiente: ${availableGb.toFixed(1)} GB disponibles.`);
      }
    }
    const portPolicy = getPortAllocationPolicy(plan.payload.template, config);
    const reservedPorts = new Set();
    const gamePort = await getNextAvailablePort(portPolicy.start, portPolicy.range, plan.nodeId, reservedPorts);
    for (let offset = 0; offset < portPolicy.range; offset += 1) reservedPorts.add(gamePort + offset);
    const adminPort = portPolicy.adminStart
      ? await getNextAvailablePort(portPolicy.adminStart, 1, plan.nodeId, reservedPorts)
      : gamePort;
    reservedPorts.add(adminPort);
    const blenderPort = await getNextAvailablePort(config.blenderPortStart, 1, plan.nodeId, reservedPorts);
    reservedPorts.add(blenderPort);
    plan.payload.reservedPorts = { gamePort, adminPort, blenderPort };

    const job = await enqueueDeployment(ownerId, idempotencyKey, plan.payload, plan, tx);
    for (const port of reservedPorts) {
      await tx(
        `INSERT INTO deployment_port_reservations (job_id, node_id, port) VALUES ($1, $2, $3)`,
        [job.id, plan.nodeId, port]
      );
    }
    return { job, plan };
  });
}

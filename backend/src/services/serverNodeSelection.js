import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { query } from '../db.js';
import { config } from '../config.js';
import { getNodeConnection } from './dockerService.js';
import { getPlanRamGb, resolveServerPlan } from './serverPlanPolicy.js';

export async function getFolderSize(dirPath) {
  let size = 0;
  try {
    const files = await fsPromises.readdir(dirPath, { withFileTypes: true });
    for (const file of files) {
      const childPath = path.join(dirPath, file.name);
      size += file.isDirectory()
        ? await getFolderSize(childPath)
        : (await fsPromises.stat(childPath)).size;
    }
  } catch {}
  return size;
}
export async function getNodeRuntimeUsage() {
  const nodeUsage = new Map();
  const { rows } = await query(`
    SELECT node_id, runtime_plan, allocated_ram_gb
    FROM servers
    WHERE status <> 'deleted'
  `);

  for (const server of rows) {
    const nodeId = Number(server.node_id ?? 0);
    const { plan } = resolveServerPlan(server.runtime_plan);
    const allocatedRamGb = Number(server.allocated_ram_gb);
    const current = nodeUsage.get(nodeId) || { count: 0, ramGb: 0 };
    current.count += 1;
    current.ramGb += Number.isFinite(allocatedRamGb) && allocatedRamGb > 0
      ? allocatedRamGb
      : getPlanRamGb(plan);
    nodeUsage.set(nodeId, current);
  }
  return nodeUsage;
}

export async function nodeCanAcceptDockerWorkload(node) {
  try {
    const docker = await getNodeConnection(node.id);
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

function localMasterNode() {
  return {
    id: 0,
    name: 'Master Node (Local)',
    ip_address: 'localhost',
    status: 'active',
    ram_total_gb: Math.max(1, Math.floor(os.totalmem() / (1024 ** 3))),
    cpu_cores: Math.max(1, os.cpus()?.length || 1)
  };
}

export async function selectDeploymentNode(plan, requestedRamGb, template, explicitNodeId = null) {
  const requiredRamGb = Number(requestedRamGb);
  if (!Number.isFinite(requiredRamGb) || requiredRamGb <= 0) {
    throw new Error(`RAM solicitada invalida para ${String(template).toUpperCase()}: ${requestedRamGb}.`);
  }

  if (explicitNodeId !== null && explicitNodeId !== undefined && explicitNodeId !== '') {
    const targetId = Number(explicitNodeId);
    if (!Number.isInteger(targetId) || targetId < 0) throw new Error('El nodo seleccionado no es valido.');
    const { rows } = await query("SELECT * FROM nodes WHERE id = $1 AND status = 'active'", [targetId]);
    const node = rows[0] || (targetId === 0 ? localMasterNode() : null);
    if (!node) throw new Error(`El nodo id ${targetId} no existe o no esta activo.`);
    if (!(await nodeCanAcceptDockerWorkload(node))) {
      throw new Error(`El nodo seleccionado '${node.name}' no responde o Docker no esta disponible.`);
    }
    return node;
  }

  // El nodo maestro local siempre debe poder comprobarse por socket. Si una
  // prueba mTLS antigua lo dejó offline, excluirlo aquí impediría su propia
  // recuperación aunque Docker y el host continuasen sanos.
  const { rows } = await query("SELECT * FROM nodes WHERE status = 'active' OR id = 0 ORDER BY id ASC");
  const nodes = rows.length > 0 ? rows : [localMasterNode()];
  const usageMap = await getNodeRuntimeUsage();
  const requiredCpu = Math.max(1, Math.ceil(Number(plan?.nanoCpus || 0) / 1e9));
  let bestNode = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    if (!(await nodeCanAcceptDockerWorkload(node))) continue;

    if (Number(node.id) === 0 && node.status !== 'active') {
      await query("UPDATE nodes SET status = 'active' WHERE id = 0");
      node.status = 'active';
    }

    const nodeId = Number(node.id);
    const usage = usageMap.get(nodeId) || { count: 0, ramGb: 0 };
    const localNode = nodeId === 0 ? localMasterNode() : null;
    const totalRam = Number(node.ram_total_gb) || localNode?.ram_total_gb || 0;
    const totalCpu = Number(node.cpu_cores) || localNode?.cpu_cores || 0;
    const availableRam = totalRam - usage.ramGb;
    if (availableRam < requiredRamGb || (totalCpu > 0 && requiredCpu > totalCpu)) continue;

    const score = (availableRam * 10) + totalCpu - (usage.count * 2);
    if (score > bestScore) {
      bestScore = score;
      bestNode = node;
    }
  }

  if (!bestNode) {
    throw new Error(`No hay nodos activos con recursos suficientes para ${String(template).toUpperCase()} (${requiredRamGb} GB RAM).`);
  }
  return bestNode;
}

export async function getNextAvailablePort(startPort, range = 1, targetNodeId = 0, excludedPorts = []) {
  const firstPort = Number(startPort) + Number(config.portBaseOffset || 0);
  const blockSize = Number(range);
  if (!Number.isInteger(firstPort) || firstPort < 1 || firstPort > 65535) {
    throw new Error(`Puerto inicial invalido: ${startPort}.`);
  }
  if (!Number.isInteger(blockSize) || blockSize < 1 || firstPort + blockSize - 1 > 65535) {
    throw new Error(`Rango de puertos invalido: inicio=${firstPort}, rango=${range}.`);
  }

  const maxScan = Math.max(blockSize, Number(process.env.PORT_SCAN_LIMIT || 5000));
  const lastPort = Math.min(65535, firstPort + maxScan);
  const usedPorts = new Set(
    Array.from(excludedPorts || [], value => Number(value)).filter(Number.isInteger)
  );
  const { rows } = await query(`
    SELECT fivem_port AS port FROM servers WHERE fivem_port IS NOT NULL AND COALESCE(node_id, 0) = $1
    UNION
    SELECT txadmin_port AS port FROM servers WHERE txadmin_port IS NOT NULL AND COALESCE(node_id, 0) = $1
    UNION
    SELECT blender_port AS port FROM servers WHERE blender_port IS NOT NULL AND COALESCE(node_id, 0) = $1
  `, [Number(targetNodeId)]);
  rows.forEach(row => usedPorts.add(Number(row.port)));

  try {
    const docker = await getNodeConnection(targetNodeId);
    const containers = await docker.listContainers({ all: true });
    for (const container of containers) {
      for (const binding of container.Ports || []) {
        if (binding.PublicPort) usedPorts.add(Number(binding.PublicPort));
      }
    }
  } catch (error) {
    console.warn(`[Ports] No se pudieron comprobar los puertos publicados del nodo ${targetNodeId}: ${error.message}`);
  }

  for (let port = firstPort; port + blockSize - 1 <= lastPort; port += blockSize) {
    const available = Array.from({ length: blockSize }, (_, offset) => port + offset)
      .every(candidate => !usedPorts.has(candidate));
    if (available) return port;
  }
  throw new Error(`No hay un bloque de ${blockSize} puerto(s) disponible desde ${firstPort}.`);
}

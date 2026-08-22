import fsPromises from 'fs/promises';
import path from 'path';
import { query } from '../db.js';
import { PLAN_LIMITS } from '../config.js';
import { getNodeConnection } from './dockerService.js';

export async function getFolderSize(dirPath) {
  let size = 0;
  try {
    const files = await fsPromises.readdir(dirPath, { withFileTypes: true });
    for (const f of files) {
      const p = path.join(dirPath, f.name);
      if (f.isDirectory()) {
        size += await getFolderSize(p);
      } else {
        const stat = await fsPromises.stat(p);
        size += stat.size;
      }
    }
  } catch (e) {}
  return size;
}

export async function getNodeRuntimeUsage() {
  const nodeUsage = new Map();
  const { rows } = await query(`
    SELECT node_id, runtime_plan, status
    FROM servers
    WHERE status <> 'deleted'
  `);

  for (const s of rows) {
    const nid = Number(s.node_id ?? 0);
    const plan = PLAN_LIMITS[s.runtime_plan] || PLAN_LIMITS.hobby;
    const current = nodeUsage.get(nid) || { count: 0, ramGb: 0 };
    current.count += 1;
    current.ramGb += Number(plan.ramGb || 0);
    nodeUsage.set(nid, current);
  }
  return nodeUsage;
}

export async function nodeCanAcceptDockerWorkload(node) {
  try {
    const docker = await getNodeConnection(node.id);
    await docker.ping();
    return true;
  } catch (e) {
    return false;
  }
}

export async function selectDeploymentNode(plan, requestedRamGb, template, explicitNodeId = null) {
  if (explicitNodeId !== null && explicitNodeId !== undefined) {
    const targetId = Number(explicitNodeId);
    const { rows } = await query('SELECT * FROM nodes WHERE id = $1', [targetId]);
    if (rows.length === 0 && targetId !== 0) throw new Error(`El nodo id ${targetId} no existe.`);
    const nodeObj = rows[0] || { id: 0, name: 'Master Node Titan R1', ip_address: 'localhost', status: 'active', ram_total_gb: 128, cpu_cores: 32 };
    
    if (targetId !== 0) {
      const ok = await nodeCanAcceptDockerWorkload(nodeObj);
      if (!ok) throw new Error(`El nodo seleccionado '${nodeObj.name}' no responde o Docker Daemon esta inalcanzable.`);
    }
    return nodeObj;
  }

  const { rows: nodes } = await query("SELECT * FROM nodes WHERE status = 'active' ORDER BY id ASC");
  if (nodes.length === 0) {
    return { id: 0, name: 'Master Node Titan R1', ip_address: 'localhost', status: 'active', ram_total_gb: 128, cpu_cores: 32 };
  }

  const usageMap = await getNodeRuntimeUsage();
  let bestNode = null;
  let bestScore = -Infinity;

  for (const node of nodes) {
    const nid = Number(node.id);
    if (nid !== 0) {
      const alive = await nodeCanAcceptDockerWorkload(node);
      if (!alive) continue;
    }

    const usage = usageMap.get(nid) || { count: 0, ramGb: 0 };
    const totalRam = Number(node.ram_total_gb) || 32;
    const reservedRam = usage.ramGb;
    const availableRam = totalRam - reservedRam;

    if (availableRam >= requestedRamGb) {
      const score = availableRam - (usage.count * 0.5);
      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    }
  }

  if (bestNode) return bestNode;
  return nodes[0];
}

export async function getNextAvailablePort(startPort, range = 1, targetNodeId = 0) {
  let port = startPort;
  while (true) {
    const portsToCheck = Array.from({ length: range }, (_, i) => port + i);
    const { rows } = await query(
      `SELECT id FROM servers WHERE (fivem_port = ANY($1::int[]) OR txadmin_port = ANY($1::int[]) OR blender_port = ANY($1::int[])) AND node_id = $2`,
      [portsToCheck, targetNodeId]
    );

    if (rows.length === 0) {
      return port;
    }
    port += range;
  }
}

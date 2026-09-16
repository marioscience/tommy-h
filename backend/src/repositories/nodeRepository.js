import { query } from '../db.js';

const EDITABLE_FIELDS = new Map([
  ['name', 'name'],
  ['ip_address', 'ip_address'],
  ['api_key', 'api_key'],
  ['status', 'status']
]);

export async function listNodes(db = query) {
  return (await db('SELECT * FROM nodes ORDER BY id ASC')).rows;
}

export async function createNode({ name, ipAddress, apiKey }, db = query) {
  return db(
    'INSERT INTO nodes (name, ip_address, api_key) VALUES ($1, $2, $3)',
    [name, ipAddress, apiKey]
  );
}

export async function updateNode(nodeId, changes, db = query) {
  const entries = Object.entries(changes).filter(([field, value]) => EDITABLE_FIELDS.has(field) && value);
  if (entries.length === 0) return { rowCount: 0 };
  const assignments = entries.map(([field], index) => `${EDITABLE_FIELDS.get(field)} = $${index + 1}`);
  const values = entries.map(([, value]) => value);
  values.push(nodeId);
  return db(`UPDATE nodes SET ${assignments.join(', ')} WHERE id = $${values.length}`, values);
}

export async function findNodeById(nodeId, db = query) {
  const result = await db('SELECT * FROM nodes WHERE id = $1', [nodeId]);
  return result.rows[0] ?? null;
}

export async function findNodeEndpointById(nodeId, db = query) {
  const result = await db('SELECT id, ip_address FROM nodes WHERE id = $1', [nodeId]);
  return result.rows[0] ?? null;
}

export async function listActiveNodes(db = query) {
  return (await db("SELECT * FROM nodes WHERE status = 'active'")).rows;
}

export async function listActiveNodeIds(db = query) {
  return (await db("SELECT id FROM nodes WHERE status = 'active'")).rows.map((node) => node.id);
}

export async function updateNodeResources(nodeId, { cpuCores, ramTotalGb }, db = query) {
  return db(
    "UPDATE nodes SET status = 'active', cpu_cores = $1, ram_total_gb = $2 WHERE id = $3",
    [cpuCores, ramTotalGb, nodeId]
  );
}

export async function updateNodeCapacity(nodeId, ramTotalGb, cpuCores, db = query) {
  return db(
    `UPDATE nodes SET ram_total_gb = $1, cpu_cores = $2
     WHERE id = $3
       AND (ram_total_gb IS DISTINCT FROM $1 OR cpu_cores IS DISTINCT FROM $2)`,
    [ramTotalGb, cpuCores, nodeId]
  );
}

export async function updateNodeStatus(nodeId, status, db = query) {
  return db('UPDATE nodes SET status = $1 WHERE id = $2', [status, nodeId]);
}

export async function deleteNode(nodeId, db = query) {
  return db('DELETE FROM nodes WHERE id = $1', [nodeId]);
}

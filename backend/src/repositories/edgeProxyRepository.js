import { query, withTransaction } from '../db.js';

const EDITABLE_FIELDS = new Map([
  ['name', 'name'],
  ['ip_address', 'ip_address'],
  ['api_port', 'api_port'],
  ['api_key', 'api_key']
]);

export async function listEdgeProxies(db = query) {
  return (await db('SELECT * FROM edge_proxies ORDER BY id ASC')).rows;
}

export async function createEdgeProxy({ name, ipAddress, apiPort = 8090, apiKey }, db = query) {
  return db(
    'INSERT INTO edge_proxies (name, ip_address, api_port, api_key) VALUES ($1, $2, $3, $4)',
    [name, ipAddress, apiPort, apiKey]
  );
}

export async function updateEdgeProxy(proxyId, changes, db = query) {
  const entries = Object.entries(changes).filter(([field, value]) => EDITABLE_FIELDS.has(field) && value);
  if (entries.length === 0) return { rowCount: 0 };
  const assignments = entries.map(([field], index) => `${EDITABLE_FIELDS.get(field)} = $${index + 1}`);
  const values = entries.map(([, value]) => value);
  values.push(proxyId);
  return db(
    `UPDATE edge_proxies SET ${assignments.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`,
    values
  );
}

export async function deleteEdgeProxy(proxyId, db = query) {
  return db('DELETE FROM edge_proxies WHERE id = $1', [proxyId]);
}

export async function findActiveEdgeProxy(db = query) {
  const result = await db(
    'SELECT ip_address, api_port, api_key FROM edge_proxies WHERE is_active = true LIMIT 1'
  );
  return result.rows[0] ?? null;
}

/**
 * Preserves the invariant that at most one edge proxy is active. Both updates
 * commit together; a missing target rolls the deactivation back.
 */
export async function activateEdgeProxy(proxyId, transaction = withTransaction) {
  return transaction(async (tx) => {
    await tx('UPDATE edge_proxies SET is_active = false WHERE is_active = true');
    const activated = await tx(
      'UPDATE edge_proxies SET is_active = true, updated_at = NOW() WHERE id = $1',
      [proxyId]
    );
    if (activated.rowCount === 0) throw new Error('EDGE_PROXY_NOT_FOUND');
    return true;
  });
}

import { query } from '../db.js';

export async function findSubuserPermissions(serverId, userId, db = query) {
  const result = await db(
    'SELECT permissions FROM subusers WHERE server_id = $1 AND user_id = $2',
    [serverId, userId]
  );
  return result.rows[0]?.permissions ?? null;
}

export async function updateServerStatus(serverId, status, db = query) {
  return db('UPDATE servers SET status = $1 WHERE id = $2', [status, serverId]);
}

export async function claimServerRecreation(serverId, db = query) {
  const result = await db(
    "UPDATE servers SET status = 'recreating' WHERE id = $1 AND status != 'recreating'",
    [serverId]
  );
  return result.rowCount > 0;
}

export async function deleteServerRecord(serverId, db = query) {
  return db('DELETE FROM servers WHERE id = $1', [serverId]);
}

export async function listMaintainableServers(db = query) {
  const result = await db(`
    SELECT servers.*, users.extra_disk_gb
    FROM servers
    LEFT JOIN users ON servers.owner_id = users.id
    WHERE servers.status NOT IN (
      'creating', 'recreating', 'stopped', 'stopping', 'suspended', 'deleting'
    )
  `);
  return result.rows;
}

export async function listServerRuntimeIdentities(db = query) {
  return (await db(
    'SELECT id, owner_id, name, container_name, node_id, status FROM servers'
  )).rows;
}

export async function getServerStatus(serverId, db = query) {
  const result = await db('SELECT status FROM servers WHERE id = $1', [serverId]);
  return result.rows[0]?.status ?? null;
}

export async function updateServerTxAdminUrl(serverId, publicUrl, db = query) {
  return db('UPDATE servers SET txadmin_url = $1 WHERE id = $2', [publicUrl, serverId]);
}

export async function findServerWebhookByContainer(containerName, db = query) {
  const result = await db(
    'SELECT name, discord_webhook_url, discord_webhook_events FROM servers WHERE container_name = $1',
    [containerName]
  );
  return result.rows[0] ?? null;
}

export async function findServerNodeIdByContainer(containerName, db = query) {
  const result = await db('SELECT node_id FROM servers WHERE container_name = $1', [containerName]);
  return result.rows[0]?.node_id ?? 0;
}

export async function listServerIdsByOwner(ownerId, db = query) {
  return (await db('SELECT id FROM servers WHERE owner_id = $1', [ownerId])).rows.map((row) => row.id);
}

export async function updateOwnedServersExpiry(ownerId, expiresAt, db = query) {
  return db('UPDATE servers SET expires_at = $1 WHERE owner_id = $2', [expiresAt, ownerId]);
}

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

export async function findUserDeploymentEntitlements(userId, db = query) {
  const result = await db(
    'SELECT plan, server_limit, extra_disk_gb, expires_at FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function listServerAllocationsByOwner(ownerId, db = query) {
  return (await db(
    'SELECT id, runtime_plan, allocated_ram_gb FROM servers WHERE owner_id = $1',
    [ownerId]
  )).rows;
}

export async function insertCreatingServer(server, db = query) {
  return db(
    `INSERT INTO servers (
      id, owner_id, name, slug, template, runtime_plan, cpuset, status,
      fivem_port, txadmin_port, blender_port, blender_pass,
      container_name, data_path, license_key_hint, txadmin_url,
      db_name, db_user, db_pass, node_id, expires_at, mc_version, mc_type,
      allocated_ram_gb
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, 'creating',
      $8, $9, $10, $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20, $21, $22, $23
    )`,
    [
      server.id, server.ownerId, server.name, server.slug, server.template,
      server.runtimePlan, server.cpuset, server.gamePort, server.txAdminPort,
      server.blenderPort, server.blenderPass, server.containerName, server.dataPath,
      server.licenseKeyHint, server.txAdminUrl, server.dbName, server.dbUser,
      server.dbPass, server.nodeId, server.expiresAt, server.mcVersion,
      server.mcType, server.allocatedRamGb
    ]
  );
}

export async function attachServerToDeploymentJob(jobId, serverId, db = query) {
  return db(
    `UPDATE deployment_jobs SET server_id = $2, updated_at = NOW()
     WHERE id = $1 AND status = 'running'`,
    [jobId, serverId]
  );
}

export async function updateServerPorts(serverId, ports, db = query) {
  return db(
    `UPDATE servers
     SET fivem_port = $2, txadmin_port = $3, blender_port = $4, txadmin_url = $5
     WHERE id = $1`,
    [serverId, ports.gamePort, ports.txAdminPort, ports.blenderPort, ports.txAdminUrl]
  );
}

export async function findServerById(serverId, db = query) {
  return (await db('SELECT * FROM servers WHERE id = $1', [serverId])).rows[0] ?? null;
}

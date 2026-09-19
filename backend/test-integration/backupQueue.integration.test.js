import test from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db.js';
import { runMigrations } from '../src/migrations.js';
import { claimNextBackup, enqueueBackup } from '../src/repositories/backupJobRepository.js';

const enabled = process.env.RUN_INTEGRATION === '1' || process.env.RUN_DB_INTEGRATION === '1';

test('backup queue persists jobs and excludes concurrent claims', { skip: !enabled }, async () => {
  await runMigrations(query, withTransaction);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const user = await query(
    `INSERT INTO users (username, email, password_hash, is_verified)
     VALUES ($1, $2, 'integration-only', true) RETURNING id`,
    [`backup-${suffix}`, `backup-${suffix}@example.invalid`]
  );
  const ownerId = user.rows[0].id;
  const servers = [];
  try {
    for (let index = 0; index < 2; index += 1) {
      const server = await query(
        `INSERT INTO servers (
           owner_id, name, slug, template, runtime_plan, container_name, status,
           fivem_port, txadmin_port, data_path, license_key_hint, txadmin_url, node_id
         ) VALUES ($1, $2, $3, 'minecraft', 'hobby', $4, 'offline', $5, $6, $7, 'none', '', NULL) RETURNING id`,
        [ownerId, `backup-${index}`, `backup-${suffix}-${index}`, `backup-${suffix}-${index}`,
          26000 + index, 27000 + index, `/tmp/backup-${suffix}-${index}`]
      );
      servers.push(server.rows[0].id);
    }
    const first = await enqueueBackup(servers[0], ownerId, false, 'integration', 'premium');
    const duplicate = await enqueueBackup(servers[0], ownerId, false, 'duplicate', 'premium');
    await enqueueBackup(servers[1], ownerId, false, 'second', 'standard');
    assert.equal(first.jobId, duplicate.jobId);

    const [claimedA, claimedB] = await Promise.all([
      claimNextBackup('backup-worker-a'), claimNextBackup('backup-worker-b')
    ]);
    assert.ok(claimedA && claimedB);
    assert.notEqual(claimedA.id, claimedB.id);
    assert.deepEqual(new Set([claimedA.server_id, claimedB.server_id]), new Set(servers));
  } finally {
    await query('DELETE FROM backup_jobs WHERE server_id = ANY($1::uuid[])', [servers]);
    await query('DELETE FROM servers WHERE id = ANY($1::uuid[])', [servers]);
    await query('DELETE FROM users WHERE id = $1', [ownerId]);
    await pool.end();
  }
});

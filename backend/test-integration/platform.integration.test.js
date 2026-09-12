import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { pool, query, withTransaction } from '../src/db.js';
import { findNodeById } from '../src/repositories/nodeRepository.js';
import { listEdgeProxies } from '../src/repositories/edgeProxyRepository.js';
import { listAdminNotifications } from '../src/repositories/notificationRepository.js';
import { findServerNodeIdByContainer, getServerStatus } from '../src/repositories/serverRepository.js';
import { listAdminUsers } from '../src/repositories/userRepository.js';
import { getContainerStats, inspectContainer } from '../src/services/dockerService.js';

const enabled = process.env.RUN_INTEGRATION === '1';
const integration = enabled ? describe : describe.skip;
const redis = createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' });

before(async () => {
  if (enabled) await redis.connect();
});

after(async () => {
  if (redis.isOpen) await redis.quit();
  await pool.end();
});

integration('Real platform integration', () => {
  it('has the complete versioned metrics schema in PostgreSQL', async () => {
    const { rows } = await query(`
      SELECT
        to_regclass('public.server_stats_history')::text AS table_name,
        EXISTS (
          SELECT 1 FROM schema_migrations
          WHERE id = '202609120001_server_stats_history'
        ) AS migration_applied
    `);

    assert.equal(rows[0].table_name, 'server_stats_history');
    assert.equal(rows[0].migration_applied, true);
  });

  it('rolls back a failed PostgreSQL transaction and keeps the pool usable', async () => {
    const marker = randomUUID();
    await assert.rejects(
      withTransaction(async (tx) => {
        await tx('CREATE TEMP TABLE integration_rollback_probe (value TEXT NOT NULL)');
        await tx('INSERT INTO integration_rollback_probe (value) VALUES ($1)', [marker]);
        throw new Error('intentional integration rollback');
      }),
      /intentional integration rollback/
    );
    const result = await query('SELECT 1 AS healthy');
    assert.equal(result.rows[0].healthy, 1);
  });

  it('round-trips an expiring probe through Redis', async () => {
    const key = `integration:probe:${randomUUID()}`;
    await redis.set(key, 'healthy', { EX: 30 });
    assert.equal(await redis.get(key), 'healthy');
    assert.equal(await redis.del(key), 1);
  });

  it('reads extracted repository domains from the real schema', async () => {
    const [users, notifications, proxies] = await Promise.all([
      listAdminUsers(),
      listAdminNotifications(),
      listEdgeProxies()
    ]);
    assert.ok(Array.isArray(users));
    assert.ok(Array.isArray(notifications));
    assert.ok(Array.isArray(proxies));
  });

  it('reads a real running game container through Docker', async (context) => {
    const { rows } = await query(`
      SELECT id, container_name, node_id, status
      FROM servers
      WHERE status = 'running'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    if (rows.length === 0) return context.skip('No running game container is available');

    assert.equal(await getServerStatus(rows[0].id), rows[0].status);
    assert.equal(await findServerNodeIdByContainer(rows[0].container_name), rows[0].node_id);
    if (rows[0].node_id) {
      const node = await findNodeById(rows[0].node_id);
      assert.equal(node?.id, rows[0].node_id);
    }

    const inspect = await inspectContainer(rows[0].container_name, { force: true });
    assert.equal(inspect.State.Running, true);
    const stats = await getContainerStats(rows[0].container_name, { force: true });
    assert.match(stats.cpu, /^\d+(?:\.\d+)?%$/);
    assert.match(stats.ram, /^\d+(?:\.\d+)?%$/);
    assert.ok(Number.isFinite(Number.parseFloat(stats.cpu)));
    assert.ok(Number.isFinite(Number.parseFloat(stats.ram)));
  });

  it('serves live liveness and dependency readiness probes', async () => {
    const baseUrl = process.env.INTEGRATION_BACKEND_URL || 'http://backend:3006';
    const [health, readiness] = await Promise.all([
      fetch(`${baseUrl}/healthz`),
      fetch(`${baseUrl}/readyz`)
    ]);
    assert.equal(health.status, 200);
    assert.equal(readiness.status, 200);
    const body = await readiness.json();
    assert.equal(typeof body.checks.database_pool.max, 'number');
    assert.equal(typeof body.checks.database_pool.waiting, 'number');
    assert.equal(typeof body.checks.database_pool.saturated, 'boolean');
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db.js';
import { runMigrations } from '../src/migrations.js';
import {
  claimDeployment,
  enqueueDeployment
} from '../src/repositories/deploymentJobRepository.js';

const enabled = process.env.RUN_DB_INTEGRATION === '1';

test('deployment queue is idempotent and claims jobs concurrently', { skip: !enabled }, async () => {
  await runMigrations(query, withTransaction);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const users = await query(
    `INSERT INTO users (username, email, password_hash, is_verified)
     VALUES ($1, $2, 'integration-only', true), ($3, $4, 'integration-only', true)
     RETURNING id`,
    [`queue-a-${suffix}`, `queue-a-${suffix}@example.invalid`, `queue-b-${suffix}`, `queue-b-${suffix}@example.invalid`]
  );
  const [firstUser, secondUser] = users.rows.map((row) => row.id);

  try {
    const first = await enqueueDeployment(firstUser, 'same-request', {
      template: 'fivem',
      licenseKey: 'cfxk_integration-secret'
    });
    const duplicate = await enqueueDeployment(firstUser, 'same-request', {
      template: 'fivem',
      licenseKey: 'different-value-must-not-replace-original'
    });
    await enqueueDeployment(secondUser, 'second-request', { template: 'minecraft' });
    assert.equal(first.id, duplicate.id);

    const [claimedA, claimedB] = await Promise.all([
      claimDeployment('integration-worker-a'),
      claimDeployment('integration-worker-b')
    ]);
    assert.ok(claimedA && claimedB);
    assert.notEqual(claimedA.id, claimedB.id);
    const fivemJob = [claimedA, claimedB].find((job) => job.payload.template === 'fivem');
    assert.equal(fivemJob.payload.licenseKey, 'cfxk_integration-secret');

    const exposed = await query(
      'SELECT payload::text AS payload, secret_ciphertext FROM deployment_jobs WHERE id = $1',
      [first.id]
    );
    assert.equal(exposed.rows[0].payload.includes('cfxk_'), false);
    assert.ok(exposed.rows[0].secret_ciphertext);
  } finally {
    await query('DELETE FROM deployment_jobs WHERE owner_id = ANY($1::int[])', [[firstUser, secondUser]]);
    await query('DELETE FROM users WHERE id = ANY($1::int[])', [[firstUser, secondUser]]);
    await pool.end();
  }
});

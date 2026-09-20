import test from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.RUN_REDIS_INTEGRATION === '1';

test('rate-limit counters are shared across independent API stores', { skip: !enabled }, async () => {
  const { DistributedRateLimitStore } = await import('../src/services/distributedRateLimitStore.js');
  const { redisClient } = await import('../src/db.js');
  const prefix = `integration-${process.pid}-${Date.now()}`;
  const firstReplica = new DistributedRateLimitStore(prefix);
  const secondReplica = new DistributedRateLimitStore(prefix);
  firstReplica.init({ windowMs: 60_000 });
  secondReplica.init({ windowMs: 60_000 });

  try {
    assert.equal((await firstReplica.increment('same-client')).totalHits, 1);
    assert.equal((await secondReplica.increment('same-client')).totalHits, 2);
    await firstReplica.resetKey('same-client');
    assert.equal((await secondReplica.increment('same-client')).totalHits, 1);
  } finally {
    await firstReplica.resetKey('same-client');
    if (redisClient.isOpen) await redisClient.quit();
  }
});

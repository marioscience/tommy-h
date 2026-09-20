import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { DistributedRateLimitStore } = await import('../src/services/distributedRateLimitStore.js');

test('distributed rate limiter preserves its contract when Redis is unavailable', async () => {
  const store = new DistributedRateLimitStore('unit-test');
  store.init({ windowMs: 60_000 });

  assert.equal((await store.increment('client-a')).totalHits, 1);
  const second = await store.increment('client-a');
  assert.equal(second.totalHits, 2);
  assert.ok(second.resetTime instanceof Date);

  await store.resetKey('client-a');
  assert.equal((await store.increment('client-a')).totalHits, 1);
});

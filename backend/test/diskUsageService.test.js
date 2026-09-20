import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';

const {
  cacheDiskUsageSample,
  clearDiskUsageCache,
  getCachedDiskUsage
} = await import('../src/services/diskUsageService.js');

test('disk usage reads return a non-blocking pending sample on cache miss', async () => {
  clearDiskUsageCache();
  assert.deepEqual(await getCachedDiskUsage('missing-server'), {
    bytes: 0,
    updatedAt: 0,
    pending: true
  });
});

test('disk usage samples are normalized and reused without filesystem access', async () => {
  clearDiskUsageCache();
  cacheDiskUsageSample('server-a', { bytes: 4_294_967_296, updatedAt: 1234 });
  assert.deepEqual(await getCachedDiskUsage('server-a'), {
    bytes: 4_294_967_296,
    updatedAt: 1234,
    pending: false
  });
});

test('disk usage rejects invalid negative sample values', async () => {
  clearDiskUsageCache();
  cacheDiskUsageSample('server-b', { bytes: -10, updatedAt: -1 });
  assert.deepEqual(await getCachedDiskUsage('server-b'), {
    bytes: 0,
    updatedAt: 0,
    pending: false
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildRestartOptions } from '../src/services/serverRestartOptions.js';

describe('Backend architecture boundaries', () => {
  it('keeps periodic maintenance owned by the worker scheduler', async () => {
    const control = await readFile(new URL('../src/services/serverControlService.js', import.meta.url), 'utf8');
    const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
    assert.doesNotMatch(control, /setInterval\s*\(/);
    assert.match(worker, /startServerMaintenance\(\)/);
  });

  it('starts Docker telemetry explicitly from the stats worker', async () => {
    const dockerService = await readFile(new URL('../src/services/dockerService.js', import.meta.url), 'utf8');
    const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
    assert.doesNotMatch(dockerService, /dockerTelemetryOwner/);
    assert.match(worker, /startDockerTelemetryCollector\(\)/);
    assert.match(worker, /startNodeMonitor\(\)/);
  });

  it('builds one canonical restart contract for every game adapter', () => {
    const options = buildRestartOptions({
      id: 'server-id',
      container_name: 'ragenodes-server-id',
      data_path: '/srv/server-id',
      fivem_port: 30120,
      txadmin_port: 40120,
      name: 'Test',
      mc_version: '1.21.4',
      mc_type: 'PAPER',
      db_name: 'game',
      db_user: 'user',
      db_pass: 'secret',
      node_id: 2,
      cluster_id: 'cluster',
      cpuset: '0-1'
    }, { memoryBytes: 1024 }, 'license');

    assert.equal(options.gamePort, 30120);
    assert.equal(options.serverId, 'server-id');
    assert.equal(options.licenseKey, 'license');
    assert.deepEqual(options.plan, { memoryBytes: 1024 });
    assert.equal(options.cpuset, '0-1');
  });

  it('keeps extracted persistence out of HTTP and orchestration modules', async () => {
    const files = [
      '../src/routes/adminNodes.js',
      '../src/routes/adminUsers.js',
      '../src/routes/auth.js',
      '../src/routes/notifications.js',
      '../src/middleware/auth.js',
      '../src/services/backupService.js',
      '../src/services/serverControlService.js',
      '../src/services/stagingHealthTestRunner.js'
    ];
    const source = (await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), 'utf8')))).join('\n');
    assert.doesNotMatch(source, /(?:FROM|INTO|UPDATE|DELETE FROM)\s+(?:backups|edge_proxies|notifications)\b/i);
    assert.doesNotMatch(source, /(?:FROM|INTO|UPDATE|DELETE FROM)\s+users\b/i);
  });
});

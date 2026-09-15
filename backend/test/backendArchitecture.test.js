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

  it('purges server data before deleting its database record', async () => {
    const control = await readFile(new URL('../src/services/serverControlService.js', import.meta.url), 'utf8');
    const purgeIndex = control.indexOf('await purgeServerDataDirectory(s.node_id, s.id, s.data_path)');
    const recordIndex = control.indexOf('await deleteServerRecord(s.id)');
    assert.ok(purgeIndex >= 0, 'server deletion must purge persistent data');
    assert.ok(recordIndex > purgeIndex, 'the database record must remain available if data cleanup fails');
    assert.doesNotMatch(control, /fs\.rm\(s\.data_path[\s\S]*catch\s*\{\s*\}/);
  });

  it('uses rootless-safe cleanup when a server creation is rolled back', async () => {
    const creation = await readFile(new URL('../src/services/serverCreationService.js', import.meta.url), 'utf8');
    assert.match(creation, /await purgeServerDataDirectory\(nodeId, serverId, dataPath\)/);
    assert.doesNotMatch(creation, /runRemoteCommand\(nodeId,[\s\S]{0,80}rm -rf/);
  });

  it('keeps CS2 port retries idempotent after rootless ownership normalization', async () => {
    const cs2 = await readFile(new URL('../src/services/games/cs2.js', import.meta.url), 'utf8');
    assert.match(cs2, /runRemoteCommand\(opts\.nodeId \|\| 0, sh`mkdir -p \$\{opts\.dataPath\}`\)/);
    assert.doesNotMatch(cs2, /mkdir -p \$\{opts\.dataPath\} && chown -R/);
    assert.match(cs2, /await normalizeCS2DataOwnership/);
  });

  it('keeps the final 7DTD path absent until the atomic template clone is promoted', async () => {
    const sdtd = await readFile(new URL('../src/services/games/sdtd.js', import.meta.url), 'utf8');
    const cloneIndex = sdtd.indexOf("cloneFromMasterTemplate('sdtd', dataPath, nodeId)");
    assert.ok(cloneIndex >= 0, '7DTD must prepare its shared template before configuring the instance');
    assert.doesNotMatch(sdtd.slice(0, cloneIndex), /mkdir -p \$\{dataPath\}/);
  });

  it('runs the runtime anomaly monitor only from the docker-events worker', async () => {
    const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
    const scheduler = await readFile(new URL('../src/services/runtimeAnomalyScheduler.js', import.meta.url), 'utf8');
    assert.match(worker, /case 'worker-docker-events':[\s\S]*startRuntimeAnomalyMonitor\(\)/);
    assert.match(scheduler, /scanRuntimeAnomalies\(\)/);
  });

  it('does not recreate a server while its initial installation is active', async () => {
    const control = await readFile(new URL('../src/services/serverControlService.js', import.meta.url), 'utf8');
    assert.match(control, /\['creating', 'recreating'\]\.includes\(s\.status\)/);
    assert.match(control, /todavía se está preparando/);
  });

  it('targets power operations at the node assigned to the server row', async () => {
    const control = await readFile(new URL('../src/services/serverControlService.js', import.meta.url), 'utf8');
    const lifecycle = await readFile(new URL('../src/services/serverRuntimeLifecycle.js', import.meta.url), 'utf8');
    assert.match(control, /startContainer\(s\.container_name, \{ nodeId: s\.node_id \}\)/);
    assert.match(control, /stopContainer\(s\.container_name, \{ nodeId: s\.node_id \}\)/);
    assert.match(lifecycle, /inspectContainer\(server\.container_name, \{ nodeId: server\.node_id \}\)/);
  });

  it('shares the configured MariaDB endpoint with FiveM and authorized clients', async () => {
    const fivem = await readFile(new URL('../src/services/games/fivem.js', import.meta.url), 'utf8');
    const servers = await readFile(new URL('../src/services/serverService.js', import.meta.url), 'utf8');
    assert.match(fivem, /TXHOST_DEFAULT_DBHOST=\$\{config\.gameDatabaseHost\}/);
    assert.match(fivem, /TXHOST_DEFAULT_DBPORT=\$\{config\.gameDatabasePort\}/);
    assert.match(servers, /s\.db_host = config\.gameDatabaseHost/);
    assert.match(servers, /if \(canViewSecrets && s\.template === 'fivem'\)/);
  });

  it('closes the temporary ARK preparation permissions even after failure', async () => {
    const ark = await readFile(new URL('../src/services/games/ark.js', import.meta.url), 'utf8');
    const openIndex = ark.indexOf('chmod 0777');
    const finallyIndex = ark.indexOf('finally', openIndex);
    const closeIndex = ark.indexOf('chmod 0755', finallyIndex);
    assert.ok(openIndex >= 0, 'ARK must prepare its host-owned UUID directory');
    assert.ok(finallyIndex > openIndex, 'ARK permission cleanup must use finally');
    assert.ok(closeIndex > finallyIndex, 'ARK must close temporary permissions');
  });
});

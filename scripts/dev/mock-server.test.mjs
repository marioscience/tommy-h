import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
test('standalone fixture: panel, scenarios, missing routes and static boundary', async (t) => {
  const child = spawn(process.execPath, ['scripts/dev/mock-server.mjs'], { env: { ...process.env, RAGENODES_DEV_MOCK: 'true', PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Mock did not start')), 10000);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Exited ${code}`)); });
    child.stdout.on('data', data => { const match = String(data).match(/:(\d+)\/panel/); if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); } });
  });
  const panel = await fetch(base + '/panel');
  assert.equal(panel.status, 200);
  assert.match(await panel.text(), /DESARROLLO SIMULADO/);
  assert.equal(panel.headers.get('x-ragenodes-simulation'), 'true');
  const me = await (await fetch(base + '/api/auth/me')).json();
  assert.equal(me.role, 'user');
  const servers = await (await fetch(base + '/api/servers')).json();
  assert.equal(servers.items[0].status, 'running');
  for (const scenario of ['node-full', 'node-offline', 'backup-failed']) {
    const response = await fetch(base + '/__dev/scenario', { method: 'POST', body: JSON.stringify({ scenario }) });
    assert.equal(response.status, 200);
  }
  const backup = await fetch(base + `/api/servers/${servers.items[0].id}/backup`, { method: 'POST' });
  assert.equal(backup.status, 400);
  assert.match((await backup.json()).error, /fallo al crear/);
  assert.equal((await fetch(base + '/api/not-implemented')).status, 501);
  assert.equal((await fetch(base + '/%2e%2e%2f%2e%2e%2f.env')).status, 403);
  assert.equal((await fetch(base + '/__dev/scenario', { method: 'POST', body: '{' })).status, 400);
});
test('mock refuses implicit activation', async () => {
  const child = spawn(process.execPath, ['scripts/dev/mock-server.mjs'], { env: { ...process.env, RAGENODES_DEV_MOCK: '' }, stdio: 'ignore' });
  assert.notEqual((await once(child, 'exit'))[0], 0);
});

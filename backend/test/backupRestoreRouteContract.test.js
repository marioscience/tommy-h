import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const routes = fs.readFileSync(new URL('../src/routes/servers.js', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../../frontend/public/js/panel.js', import.meta.url), 'utf8');

test('backup restore rejects an invalid server id before database access', () => {
  const routeStart = routes.indexOf("router.post('/:id/backups/restore'");
  const restoreCall = routes.indexOf('await restoreBackup(', routeStart);
  const validation = routes.indexOf('SERVER_ID_PATTERN.test(req.params.id)', routeStart);
  assert.ok(routeStart >= 0 && validation > routeStart && validation < restoreCall);
  assert.match(routes.slice(validation, restoreCall), /status\(400\)/);
});

test('backup actions retain the server context that produced each row', () => {
  assert.match(panel, /const backupServerId = currentServerId/);
  assert.match(panel, /restoreClientBackup\(\(backupServerId\), \(b\.filename\)\)/);
  assert.match(panel, /deleteClientBackup\(\(backupServerId\), \(b\.filename\)\)/);
  assert.match(panel, /currentServerId !== backupServerId/);
  assert.doesNotMatch(panel, /servers\/\$\{currentServerId\}\/backups\/restore/);
});

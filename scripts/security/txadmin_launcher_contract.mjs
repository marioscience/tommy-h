import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel = fs.readFileSync('frontend/public/panel.html', 'utf8');
const actions = fs.readFileSync('frontend/public/js/privileged-actions.generated.js', 'utf8');

assert.match(panel, /id="nav-txadmin"[^>]+data-rn-onclick="priv_0081"/);
assert.match(actions, /"priv_0081"[\s\S]*?switchView\('txadmin', this\)/);

for (const template of [
  'frontend/public/games/fivem.html',
  'frontend/public/games/fivem_v3.html'
]) {
  const source = fs.readFileSync(template, 'utf8');
  assert.match(source, /Credenciales MariaDB para configurar txAdmin/);
  assert.match(source, /host\.docker\.internal/);
  assert.match(source, /id="tx-top-db"/);
  assert.match(source, /id="tx-top-user"/);
  assert.match(source, /id="tx-top-pass"/);
  assert.match(source, /Abrir txAdmin/);
  assert.match(source, /id="txadmin-offline-notice"/);
  assert.doesNotMatch(source, /id="txadmin-offline-overlay"/);
  assert.doesNotMatch(source, /<iframe[^>]+txadmin/i);
}

console.log('txAdmin launcher contract passed.');

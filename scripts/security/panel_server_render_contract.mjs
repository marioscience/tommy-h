import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'frontend/public');
const [panelHtml, bindingsSource, commonSource, panelSource, minecraftPartial] = await Promise.all([
  fs.readFile(path.join(publicDir, 'panel.html'), 'utf8'),
  fs.readFile(path.join(publicDir, 'js/csp-bindings.js'), 'utf8'),
  fs.readFile(path.join(publicDir, 'js/common.js'), 'utf8'),
  fs.readFile(path.join(publicDir, 'js/panel.js'), 'utf8'),
  fs.readFile(path.join(publicDir, 'games/minecraft.html'), 'utf8')
]);

assert.match(
  panelHtml,
  /js\/panel\.js\?v=2026083002/,
  'panel.html debe invalidar la cache cuando cambia panel.js'
);

const warnings = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('error', (...args) => warnings.push(args.join(' ')));
virtualConsole.on('warn', (...args) => warnings.push(args.join(' ')));
virtualConsole.on('jsdomError', error => warnings.push(error.message));

const dom = new JSDOM(panelHtml, {
  url: 'https://panel.ragenodes.dev/panel',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole
});
const { window } = dom;

const server = {
  id: '4d747db7-20eb-4578-89fb-cb12492c8b55',
  owner_id: 2,
  name: 'Minecraft staging',
  template: 'minecraft',
  runtime_plan: 'hobby',
  status: 'running',
  fivem_port: 35500,
  txadmin_port: 35500,
  blender_port: 60120,
  container_name: 'ragenodes-4d747db7',
  allocated_ram_gb: 2,
  extra_disk_gb: 0,
  node_id: 0,
  mc_version: '1.21.4',
  mc_type: 'PAPER',
  expires_at: null,
  stats: { cpu: 1.2, ram: 25, ramGb: 1.1, disk: 0.2, diskGb: 0.05, net_rx: 0, net_tx: 0 }
};

window.localStorage.setItem('nexus_user', JSON.stringify({ id: 2, username: 'test', role: 'user', plan: 'hobby' }));
window.alert = () => {};
window.confirm = () => true;
window.open = () => null;
window.scrollTo = () => {};
window.requestAnimationFrame = callback => window.setTimeout(callback, 0);
window.cancelAnimationFrame = id => window.clearTimeout(id);
window.ResizeObserver = class { observe() {} disconnect() {} };
window.Chart = class { destroy() {} update() {} };
window.EventSource = class { addEventListener() {} close() {} };
window.WebSocket = class { close() {} };
window.require = Object.assign(() => {}, { config() {} });
window.fetch = async input => {
  const url = String(input);
  let body = {};
  if (url.startsWith('/api/servers/') && url.endsWith('/stats-history')) body = { items: [] };
  else if (url.startsWith('/api/servers')) body = { items: [server], publicHost: 'node1.ragenodes.dev' };
  else if (url.startsWith('/api/auth/me')) body = { id: 2, username: 'test', role: 'user', plan: 'hobby' };
  else if (url.startsWith('/games/minecraft.html')) return new Response(minecraftPartial, { status: 200, headers: { 'content-type': 'text/html' } });
  else body = { items: [] };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

// Reproduce una recarga directa en la que el dashboard todavia no fue activado.
window.document.getElementById('view-servers').classList.add('hidden');
window.eval(bindingsSource);
window.eval(commonSource);
window.eval(panelSource);
window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
await new Promise(resolve => window.setTimeout(resolve, 100));

const dashboard = window.document.getElementById('client-servers');
assert.ok(dashboard, 'El contenedor principal del panel debe existir');
assert.equal(
  window.document.getElementById('view-servers').classList.contains('hidden'),
  false,
  'La carga inicial debe activar la vista principal antes de renderizar'
);
assert.match(dashboard.textContent, /Minecraft staging/, 'El servidor Minecraft debe renderizarse en el panel');
assert.match(dashboard.textContent, /Conexi.n In-Game/, 'El panel debe mostrar la conexión del servidor');
assert.equal(
  warnings.filter(message => message.includes('Polling loadServers')).length,
  0,
  `loadServers no debe fallar: ${warnings.join(' | ')}`
);

window.openDeployModal('', 'minecraft');
window.document.getElementById('modal-deploy-name').value = 'Minecraft staging';
window.document.getElementById('view-servers').classList.add('hidden');
await window.executeDeploy();
await new Promise(resolve => window.setTimeout(resolve, 50));
assert.equal(
  window.document.getElementById('view-servers').classList.contains('hidden'),
  false,
  'Tras desplegar, la vista principal debe quedar visible aunque el modal se abriera desde otra vista'
);

window.close();
console.log('Panel server render contract passed');

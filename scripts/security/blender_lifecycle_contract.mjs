import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(
  path.join(root, 'backend/src/services/serverSettings.js'),
  'utf8'
);
const panelSource = fs.readFileSync(
  path.join(root, 'frontend/public/js/panel.js'),
  'utf8'
);
const proxySource = fs.readFileSync(
  path.join(root, 'oxideproxy/src/pipeline/http_server.rs'),
  'utf8'
);

assert.ok(
  source.includes("import { toggleBlender as toggleBlenderContainer } from './dockerService.js';"),
  'El ciclo de Blender debe utilizar el controlador Docker operativo'
);
assert.match(source, /String\(s\.template\)\.toLowerCase\(\) !== 'fivem'/);
assert.match(source, /toggleBlenderContainer\(\{[\s\S]*?serverId:\s*s\.id[\s\S]*?blenderPort:\s*s\.blender_port[\s\S]*?\}, action\)/);
assert.ok(!source.includes('gameSvc.toggleBlender'),
  'No debe invocarse un método inexistente en el adaptador FiveM');
assert.match(panelSource, /\/blender\/\$\{data\.shortId\}\/\?port=\$\{encodeURIComponent\(blenderPort\)\}/);
assert.match(proxySource, /OXIDE_BLENDER_PORT_START/);
assert.match(proxySource, /OXIDE_BLENDER_PORT_END/);
assert.match(proxySource, /dynamic_backend_addr\(host_without_port, port\)/);

console.log('Blender lifecycle contract: OK');

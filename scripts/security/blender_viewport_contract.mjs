import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const panelHtml = fs.readFileSync(path.join(root, 'frontend/public/panel.html'), 'utf8');
const panelJs = fs.readFileSync(path.join(root, 'frontend/public/js/panel.js'), 'utf8');

for (const selector of [
  '#game-specific-views',
  '#view-blender > div',
  '#blender-iframe-container',
  '#blender-iframe',
]) {
  assert.ok(panelHtml.includes(selector), `Falta el contrato de layout para ${selector}`);
}

assert.match(panelHtml, /#blender-iframe-container\s*\{[\s\S]*?min-height:\s*0\s*!important/);
assert.match(panelHtml, /#view-blender\s*>\s*div\s*\{[\s\S]*?overflow:\s*hidden\s*!important/);

const loaderStart = panelJs.indexOf('async function loadBlenderFrame(url)');
const loaderEnd = panelJs.indexOf('async function openBlender(id)', loaderStart);
assert.ok(loaderStart >= 0 && loaderEnd > loaderStart, 'Falta loadBlenderFrame');

const loader = panelJs.slice(loaderStart, loaderEnd);
assert.ok(loader.includes("absoluteUrl.origin !== window.location.origin"),
  'El visor debe rechazar destinos externos');
assert.ok(loader.indexOf('await waitForBlenderLayout()') < loader.indexOf('iframe.src = absoluteUrl.href'),
  'El iframe debe esperar al layout antes de navegar');
assert.ok(loader.indexOf('resizeBlenderFrame()') < loader.indexOf('iframe.src = absoluteUrl.href'),
  'El iframe debe tener altura real antes de navegar');
assert.match(panelJs, /else if \(savedBlenderUrl\) \{[\s\S]*?loadBlenderFrame\(savedBlenderUrl\)/);
assert.match(panelJs, /function confirmBlenderAuth\(\) \{[\s\S]*?loadBlenderFrame\(blenderPendingUrl\)/);

console.log('Blender viewport contract: OK');

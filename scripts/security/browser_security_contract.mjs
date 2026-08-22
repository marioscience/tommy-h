import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const baseUrl = (process.env.SECURITY_TEST_PUBLIC_URL || 'http://127.0.0.1').replace(/\/$/, '');

async function request(path) {
  return fetch(`${baseUrl}${path}`, {
    redirect: 'manual',
    headers: { Accept: 'text/html' }
  });
}

function cspDirective(csp, name) {
  return csp
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => directive === name || directive.startsWith(`${name} `)) || '';
}

function pass(message) {
  console.log(`PASS ${message}`);
}

for (const path of ['/', '/hosting-fivem.html', '/creadores.html']) {
  const response = await request(path);
  assert.equal(response.status, 200, `${path} must be available`);
  const csp = response.headers.get('content-security-policy') || '';
  assert.equal(cspDirective(csp, 'script-src-attr'), "script-src-attr 'none'");
  assert.match(cspDirective(csp, 'script-src'), /'nonce-[^']+'/);
  assert.match(cspDirective(csp, 'script-src'), /'strict-dynamic'/);
  assert.doesNotMatch(cspDirective(csp, 'script-src'), /'unsafe-inline'|'unsafe-eval'/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.match(response.headers.get('permissions-policy') || '', /usb=\(\)/);

  const document = new JSDOM(await response.text()).window.document;
  const inlineEventAttributes = [...document.querySelectorAll('*')].flatMap((element) =>
    [...element.attributes].filter((attribute) => /^on/i.test(attribute.name))
  );
  assert.equal(inlineEventAttributes.length, 0, `${path} must not contain inline event attributes`);
  assert.ok(
    [...document.scripts].some((script) => script.src.includes('/js/public-actions.generated.js')),
    `${path} must load the delegated public actions module`
  );
  pass(`${path} enforces strict script attributes and delegated events`);
}

for (const path of ['/privacidad.html', '/terminos.html']) {
  const response = await request(path);
  assert.equal(response.status, 200, `${path} must be available`);
  const csp = response.headers.get('content-security-policy') || '';
  assert.equal(cspDirective(csp, 'script-src-attr'), "script-src-attr 'none'");
  assert.equal(response.headers.get('cross-origin-embedder-policy'), 'credentialless');
  pass(`${path} keeps the isolated static-page policy`);
}

{
  const response = await request('/admin.html');
  assert.equal(response.status, 200, '/admin.html must be available locally');
  const csp = response.headers.get('content-security-policy') || '';
  assert.equal(cspDirective(csp, 'script-src-attr'), "script-src-attr 'none'");
  assert.match(cspDirective(csp, 'frame-src'), /'self'/);
  const document = new JSDOM(await response.text()).window.document;
  assert.equal(
    [...document.querySelectorAll('*')].flatMap((element) =>
      [...element.attributes].filter((attribute) => /^on/i.test(attribute.name))
    ).length,
    0
  );
  assert.ok([...document.scripts].some((script) => script.src.includes('js/privileged-actions.generated.js')));
  pass('/admin.html enforces strict script attributes and delegated events');
}

{
  const response = await request('/panel.html');
  assert.equal(response.status, 200, '/panel.html must be available locally');
  const csp = response.headers.get('content-security-policy') || '';
  assert.equal(cspDirective(csp, 'script-src-attr'), "script-src-attr 'none'");
  assert.match(cspDirective(csp, 'frame-src'), /'self'/);
  const document = new JSDOM(await response.text()).window.document;
  assert.equal(
    [...document.querySelectorAll('*')].flatMap((element) =>
      [...element.attributes].filter((attribute) => /^on/i.test(attribute.name))
    ).length,
    0
  );
  assert.ok([...document.scripts].some((script) => script.src.includes('js/csp-bindings.js')));
  assert.ok([...document.scripts].some((script) => script.src.includes('js/privileged-actions.generated.js')));
  assert.ok([...document.scripts].some((script) => script.src.includes('js/csp-style-nonce.js')));
  assert.equal(document.querySelector('link[href*="css/panel.css"], link[href*="css/theme.css"]'), null);
  pass('/panel.html enforces strict script attributes and CSP-safe dynamic bindings');
}

{
  const response = await request('/pma/');
  const csp = response.headers.get('content-security-policy') || '';
  assert.equal(response.status, 200, '/pma/ must be reachable from the local panel');
  assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(cspDirective(csp, 'frame-ancestors'), "frame-ancestors 'self'");
  pass('/pma/ permits only same-origin embedding');
}

{
  const response = await request('/oxide/');
  const csp = response.headers.get('content-security-policy') || '';
  assert.equal(response.status, 401, '/oxide/ must require an authenticated administrator');
  assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(cspDirective(csp, 'frame-ancestors'), "frame-ancestors 'self'");
  assert.equal(cspDirective(csp, 'script-src-attr'), "script-src-attr 'none'");
  assert.equal(cspDirective(csp, 'style-src-attr'), "style-src-attr 'none'");
  pass('/oxide/ requires an administrator and only permits same-origin embedding');
}

{
  const response = await request('/api/oxide/config');
  assert.equal(response.status, 401, 'Oxide API must reject anonymous requests');
  pass('/api/oxide/config rejects anonymous access');
}

for (const path of ['/.env', '/panel_backup.html', '/definitely-not-a-real-page']) {
  const response = await request(path);
  assert.equal(response.status, 404, `${path} must not be served`);
  pass(`${path} is not exposed`);
}

console.log('Browser security contract passed.');

const baseUrl = new URL(process.env.SECURITY_TEST_BASE_URL || 'http://127.0.0.1');
const REQUEST_TIMEOUT_MS = Number(process.env.SECURITY_TEST_TIMEOUT_MS || 5000);

async function securityFetch(path, options = {}) {
  return fetch(new URL(path, baseUrl), {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
}

const protectedRoutes = [
  ['GET', '/api/auth/me'],
  ['GET', '/api/admin/overview'],
  ['GET', '/api/admin/diagnostics/defaults'],
  ['GET', '/api/servers'],
  ['GET', '/api/files/list?serverId=00000000-0000-0000-0000-000000000000&path=/'],
  ['GET', '/api/notifications'],
  ['GET', '/api/payments/invoices'],
  ['GET', '/api/marketplace/my-licenses'],
  ['POST', '/api/tickets/create'],
  ['GET', '/api/minecraft/00000000-0000-0000-0000-000000000000/properties'],
  ['GET', '/api/rcon/00000000-0000-0000-0000-000000000000/players'],
  ['GET', '/api/cron/00000000-0000-0000-0000-000000000000'],
  ['GET', '/api/plugins/search?game=rust&q=test'],
  ['GET', '/api/mods/00000000-0000-0000-0000-000000000000'],
  ['GET', '/api/minecraft-mods/00000000-0000-0000-0000-000000000000/search?q=test']
];

let failures = 0;
for (const [method, path] of protectedRoutes) {
  let response;
  try {
    response = await securityFetch(path, {
      method,
      headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
      body: method === 'POST' ? '{}' : undefined,
      redirect: 'manual'
    });
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${method} ${path}: request failed (${error.message})`);
    continue;
  }
  const accepted = response.status === 401
    || (path.startsWith('/api/admin') && response.status === 403);
  if (!accepted) {
    failures += 1;
    console.error(`FAIL ${method} ${path}: expected 401/403, received ${response.status}`);
  } else {
    console.log(`PASS ${method} ${path}: ${response.status}`);
  }
}

const queryTokenResponse = await securityFetch('/api/auth/me?token=fake', { redirect: 'manual' });
if (queryTokenResponse.status !== 401) {
  failures += 1;
  console.error(`FAIL query-string token rejection: received ${queryTokenResponse.status}`);
} else {
  console.log('PASS query-string token rejection');
}

const csrfResponse = await securityFetch('/api/auth/logout', {
  method: 'POST',
  headers: {
    cookie: 'rn_session=fake',
    origin: 'https://attacker.invalid',
    'content-type': 'application/json'
  },
  body: '{}',
  redirect: 'manual'
});
if (csrfResponse.status !== 403) {
  failures += 1;
  console.error(`FAIL CSRF origin rejection: received ${csrfResponse.status}`);
} else {
  console.log('PASS CSRF origin rejection');
}

if (failures > 0) {
  console.error(`Route authorization smoke test failed: ${failures} finding(s).`);
  process.exit(1);
}

console.log('Route authorization smoke test passed.');

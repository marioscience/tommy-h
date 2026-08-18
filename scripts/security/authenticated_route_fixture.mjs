import crypto from 'crypto';
import fs from 'fs/promises';
import { query } from 'file:///app/src/db.js';
import { config } from 'file:///app/src/config.js';
import { signToken } from 'file:///app/src/middleware/auth.js';

const baseUrl = new URL(process.env.SECURITY_TEST_INTERNAL_URL || 'http://127.0.0.1:3006');
const allowedOrigin = String(config.corsOrigin || '')
  .split(',')
  .map(value => value.trim())
  .find(Boolean);
const suffix = crypto.randomBytes(6).toString('hex');
const fixtureIds = [];
const fixturePath = `/tmp/ragenodes-authz-${suffix}`;
let serverId;
let failures = 0;

function pass(message) {
  console.log(`PASS ${message}`);
}

function fail(message) {
  failures += 1;
  console.error(`FAIL ${message}`);
}

function assert(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

function sessionCookie(user) {
  return `${config.sessionCookieName}=${encodeURIComponent(signToken(user))}`;
}

async function requestAs(user, method, route, body, options = {}) {
  const headers = {
    cookie: sessionCookie(user),
    ...(body === undefined ? {} : { 'content-type': 'application/json' })
  };
  if (options.origin !== false && !['GET', 'HEAD'].includes(method)) {
    headers.origin = allowedOrigin;
  }
  return fetch(new URL(route, baseUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  });
}

async function parseJson(response) {
  try { return await response.json(); } catch { return {}; }
}

try {
  await fs.mkdir(fixturePath, { recursive: true });

  const users = {};
  for (const role of ['owner', 'member', 'stranger']) {
    const username = `security_http_${role}_${suffix}`;
    const result = await query(
      `INSERT INTO users (username, password_hash, role, is_verified)
       VALUES ($1, '$2a$12$83WzC23z2J7aw0o4AfUZG.kauDaz2kmF.y1QAbYMNgDG6IqYAMuDy', 'client', true)
       RETURNING id, username, role, token_version`,
      [username]
    );
    users[role] = result.rows[0];
    fixtureIds.push(result.rows[0].id);
  }

  const server = await query(
    `INSERT INTO servers (
       owner_id, name, slug, template, runtime_plan, status, fivem_port, txadmin_port,
       container_name, data_path, license_key_hint, txadmin_url
     ) VALUES ($1,$2,$3,'minecraft','hobby','stopped',$4,$5,$6,$7,'fixture-secret','http://127.0.0.1')
     RETURNING id`,
    [
      users.owner.id,
      `Security HTTP fixture ${suffix}`,
      `security-http-${suffix}`,
      63000 + Math.floor(Math.random() * 500),
      63500 + Math.floor(Math.random() * 35),
      `security-http-fixture-${suffix}`,
      fixturePath
    ]
  );
  serverId = server.rows[0].id;

  await query(
    `INSERT INTO server_subusers (server_id, user_id, permissions) VALUES ($1, $2, $3)`,
    [serverId, users.member.id, JSON.stringify(['restart', 'console'])]
  );

  let response = await requestAs(users.owner, 'GET', `/api/servers/${serverId}`);
  let payload = await parseJson(response);
  assert(response.status === 200, 'owner can read the owned server over HTTP');
  assert(payload.item?.data_path === fixturePath, 'owner receives owner-only server fields');

  response = await requestAs(users.member, 'GET', `/api/servers/${serverId}`);
  payload = await parseJson(response);
  assert(response.status === 200, 'subuser can read the delegated server over HTTP');
  assert(
    payload.item && !('data_path' in payload.item) && !('container_name' in payload.item) && !('license_key_hint' in payload.item),
    'subuser response redacts filesystem, container and license details'
  );

  response = await requestAs(users.stranger, 'GET', `/api/servers/${serverId}`);
  assert(response.status === 404, 'unrelated user cannot resolve the server over HTTP');

  response = await requestAs(users.owner, 'GET', `/api/files/list?serverId=${serverId}&path=/`);
  assert(response.status === 200, 'owner can access server files');

  response = await requestAs(users.member, 'GET', `/api/files/list?serverId=${serverId}&path=/`);
  assert(response.status === 404, 'subuser without files permission cannot list files');

  response = await requestAs(users.stranger, 'GET', `/api/files/list?serverId=${serverId}&path=/`);
  assert(response.status === 404, 'unrelated user cannot list server files');

  response = await requestAs(users.owner, 'GET', `/api/servers/${serverId}/subusers`);
  assert(response.status === 200, 'owner can enumerate the delegated team');

  response = await requestAs(users.member, 'GET', `/api/servers/${serverId}/subusers`);
  assert(response.status === 400, 'subuser cannot enumerate the owner team');

  response = await requestAs(users.member, 'POST', `/api/servers/${serverId}/backup-time`, { time: '03:00' });
  assert(response.status === 400, 'subuser without files permission cannot change backup settings');

  response = await requestAs(users.member, 'DELETE', `/api/servers/${serverId}`);
  assert(response.status === 400, 'subuser cannot delete the delegated server');
  const stillExists = await query('SELECT 1 FROM servers WHERE id = $1', [serverId]);
  assert(stillExists.rowCount === 1, 'denied deletion leaves the server intact');

  response = await requestAs(users.owner, 'DELETE', `/api/servers/${serverId}`, undefined, { origin: false });
  assert(response.status === 403, 'cookie-authenticated mutation without an Origin is rejected');

  response = await requestAs(users.owner, 'GET', '/api/admin/overview');
  assert(response.status === 403, 'client token cannot access an admin route');

  const queryTokenResponse = await fetch(new URL('/api/auth/me?token=fake', baseUrl), { redirect: 'manual' });
  assert(queryTokenResponse.status === 401, 'query-string tokens are not accepted');
} catch (error) {
  fail(`authenticated route fixture aborted: ${error.message}`);
} finally {
  if (serverId) await query('DELETE FROM servers WHERE id = $1', [serverId]).catch(() => {});
  if (fixtureIds.length) await query('DELETE FROM users WHERE id = ANY($1::int[])', [fixtureIds]).catch(() => {});
  await fs.rm(fixturePath, { recursive: true, force: true }).catch(() => {});
}

if (failures) {
  console.error(`Authenticated route fixture failed: ${failures} finding(s).`);
  process.exit(1);
}

console.log('Authenticated route fixture passed.');
process.exit(0);

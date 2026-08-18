import crypto from 'crypto';
import { query } from 'file:///app/src/db.js';
import {
  deleteServer,
  getServerByIdForUser,
  getSubusersForServer,
  setServerBackupTime,
  updateServerWebhook
} from 'file:///app/src/services/serverService.js';

const suffix = crypto.randomBytes(6).toString('hex');
const fixtureIds = [];
let serverId;
let failed = false;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

async function expectDenied(operation, message) {
  try {
    await operation();
    throw new Error(`NOT_DENIED: ${message}`);
  } catch (error) {
    if (String(error.message).startsWith('NOT_DENIED:')) throw error;
    console.log(`PASS ${message}`);
  }
}

try {
  for (const role of ['owner', 'member', 'stranger']) {
    const result = await query(
      `INSERT INTO users (username, password_hash, role, is_verified)
       VALUES ($1, '$2a$12$83WzC23z2J7aw0o4AfUZG.kauDaz2kmF.y1QAbYMNgDG6IqYAMuDy', 'client', true)
       RETURNING id`,
      [`security_${role}_${suffix}`]
    );
    fixtureIds.push(result.rows[0].id);
  }

  const [ownerId, memberId, strangerId] = fixtureIds;
  const server = await query(
    `INSERT INTO servers (
       owner_id, name, slug, template, runtime_plan, status, fivem_port, txadmin_port,
       container_name, data_path, license_key_hint, txadmin_url
     ) VALUES ($1,$2,$3,'minecraft','hobby','stopped',$4,$5,$6,$7,'fixture','http://127.0.0.1')
     RETURNING id`,
    [ownerId, `Security fixture ${suffix}`, `security-${suffix}`, 61000 + Math.floor(Math.random() * 1000), 62000 + Math.floor(Math.random() * 1000), `security-fixture-${suffix}`, `/tmp/security-${suffix}`]
  );
  serverId = server.rows[0].id;

  await query(
    `INSERT INTO server_subusers (server_id, user_id, permissions) VALUES ($1, $2, $3)`,
    [serverId, memberId, JSON.stringify(['restart', 'console'])]
  );

  assert(await getServerByIdForUser(serverId, ownerId, false, 'files'), 'owner retains file access');
  assert(await getServerByIdForUser(serverId, memberId, false, 'console'), 'member receives granted console access');
  assert(!(await getServerByIdForUser(serverId, memberId, false, 'files')), 'member is denied ungranted file access');
  assert(!(await getServerByIdForUser(serverId, strangerId, false)), 'unrelated user cannot resolve server');

  await expectDenied(
    () => setServerBackupTime(serverId, memberId, '03:00', false),
    'member cannot change backup settings without files permission'
  );
  await expectDenied(
    () => deleteServer(serverId, memberId, false),
    'member cannot delete server'
  );
  await expectDenied(
    () => getSubusersForServer(serverId, memberId, false),
    'member cannot enumerate the owner team'
  );
  await expectDenied(
    () => updateServerWebhook(serverId, memberId, false, 'https://attacker.invalid', [], false),
    'member cannot replace owner webhook'
  );

  console.log('Authorization fixture test passed.');
} catch (error) {
  failed = true;
  console.error(`Authorization fixture test failed: ${error.message}`);
} finally {
  if (serverId) await query('DELETE FROM servers WHERE id = $1', [serverId]).catch(() => {});
  if (fixtureIds.length) await query('DELETE FROM users WHERE id = ANY($1::int[])', [fixtureIds]).catch(() => {});
}

process.exit(failed ? 1 : 0);

import { query } from '../db.js';

const ADMIN_EDITABLE_FIELDS = new Map([
  ['username', 'username'],
  ['email', 'email'],
  ['role', 'role'],
  ['plan', 'plan'],
  ['server_limit', 'server_limit'],
  ['expires_at', 'expires_at'],
  ['password_hash', 'password_hash']
]);

export async function findUserIdByUsername(username, db = query) {
  return (await db('SELECT id FROM users WHERE username = $1', [username])).rows[0]?.id ?? null;
}

export async function createAdminUser({ username, passwordHash, role, plan }, db = query) {
  return db(
    'INSERT INTO users (username, password_hash, role, plan, is_verified) VALUES ($1, $2, $3, $4, true)',
    [username, passwordHash, role, plan]
  );
}

export async function resetUserPassword(userId, passwordHash, db = query) {
  return db(
    'UPDATE users SET password_hash = $1, token_version = COALESCE(token_version, 0) + 1 WHERE id = $2',
    [passwordHash, userId]
  );
}

export async function updateAdminUser(userId, changes, db = query) {
  const entries = Object.entries(changes).filter(([field, value]) =>
    ADMIN_EDITABLE_FIELDS.has(field) && value !== undefined
  );
  if (entries.length === 0) return { rowCount: 0 };
  const assignments = entries.map(([field], index) => `${ADMIN_EDITABLE_FIELDS.get(field)} = $${index + 1}`);
  const values = entries.map(([, value]) => value);
  values.push(userId);
  return db(`UPDATE users SET ${assignments.join(', ')} WHERE id = $${values.length}`, values);
}

export async function listAdminUsers(db = query) {
  return (await db(
    'SELECT id, username, email, role, plan, expires_at, is_verified, created_at FROM users ORDER BY created_at DESC'
  )).rows;
}

export async function deleteNonAdminUser(userId, db = query) {
  return db("DELETE FROM users WHERE id = $1 AND role != 'admin'", [userId]);
}

export async function findImpersonationUser(userId, db = query) {
  const result = await db(
    'SELECT id, username, email, role, is_verified, token_version FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function findUsernameById(userId, db = query) {
  return (await db('SELECT username FROM users WHERE id = $1', [userId])).rows[0]?.username ?? null;
}

export async function createInviteKey({ code, createdBy, maxUses }, db = query) {
  return (await db(
    'INSERT INTO invite_keys (code, created_by, max_uses) VALUES ($1, $2, $3) RETURNING *',
    [code, createdBy, maxUses]
  )).rows[0];
}

export async function listInviteKeys(db = query) {
  return (await db('SELECT * FROM invite_keys ORDER BY created_at DESC')).rows;
}

export async function deleteInviteKey(code, db = query) {
  return db('DELETE FROM invite_keys WHERE code = $1', [code]);
}

export async function findUserByLogin(identifier, db = query) {
  return (await db(
    'SELECT * FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)',
    [identifier]
  )).rows[0] ?? null;
}

export async function consumeInviteKey(code, db = query) {
  return (await db(
    'UPDATE invite_keys SET uses = uses + 1 WHERE code = $1 AND uses < max_uses RETURNING id',
    [code]
  )).rowCount > 0;
}

export async function createRegisteredUser(user, db = query) {
  return db(
    'INSERT INTO users (username, email, password_hash, expires_at, plan, verify_token) VALUES ($1, $2, $3, $4, $5, $6)',
    [user.username, user.email, user.passwordHash, user.expiresAt, user.plan, user.verifyToken]
  );
}

export async function findUserByEmail(email, db = query) {
  return (await db('SELECT * FROM users WHERE email = $1', [email])).rows[0] ?? null;
}

export async function setPasswordReset(userId, token, expiresAt, db = query) {
  return db('UPDATE users SET reset_token = $1, reset_expires = $2 WHERE id = $3', [token, expiresAt, userId]);
}

export async function findUserByValidResetToken(token, db = query) {
  return (await db('SELECT * FROM users WHERE reset_token = $1 AND reset_expires > NOW()', [token])).rows[0] ?? null;
}

export async function completePasswordReset(userId, passwordHash, db = query) {
  return db('UPDATE users SET password_hash = $1, reset_token = NULL, reset_expires = NULL, token_version = token_version + 1 WHERE id = $2', [passwordHash, userId]);
}

export async function findUserByVerificationToken(token, db = query) {
  return (await db('SELECT * FROM users WHERE verify_token = $1', [token])).rows[0] ?? null;
}

export async function markUserVerified(userId, db = query) {
  return db('UPDATE users SET is_verified = true, verify_token = NULL WHERE id = $1', [userId]);
}

export async function findUserById(userId, db = query) {
  return (await db('SELECT * FROM users WHERE id = $1', [userId])).rows[0] ?? null;
}

export async function findUserIdByEmail(email, db = query) {
  return (await db('SELECT id FROM users WHERE email = $1', [email])).rows[0]?.id ?? null;
}

export async function updateUserEmailVerification(userId, email, token, db = query) {
  return db('UPDATE users SET email = $1, is_verified = false, verify_token = $2 WHERE id = $3', [email, token, userId]);
}

export async function findVerificationProfile(userId, db = query) {
  const result = await db('SELECT username, email, is_verified FROM users WHERE id = $1', [userId]);
  return result.rows[0] ?? null;
}

export async function setVerificationToken(userId, token, db = query) {
  return db('UPDATE users SET verify_token = $1 WHERE id = $2', [token, userId]);
}

export async function findPublicUserProfile(userId, db = query) {
  const result = await db(
    'SELECT id, username, email, role, plan, is_verified, discord_id FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function findUserIdByDiscordId(discordId, db = query) {
  return (await db('SELECT id FROM users WHERE discord_id = $1', [discordId])).rows[0]?.id ?? null;
}

export async function linkDiscordId(userId, discordId, db = query) {
  return (await db('UPDATE users SET discord_id = $1 WHERE id = $2 RETURNING id', [discordId, userId])).rowCount > 0;
}

export async function findUserTokenVersion(userId, db = query) {
  const result = await db('SELECT id, token_version FROM users WHERE id = $1', [userId]);
  return result.rows[0] ?? null;
}

export async function deleteOrphanedGeneratedUsers(db = query) {
  return db(`
    DELETE FROM users
    WHERE id NOT IN (SELECT owner_id FROM servers)
      AND id NOT IN (SELECT user_id FROM subusers)
      AND role != 'admin'
      AND username ~ '_[0-9a-f]{4}$'
  `);
}

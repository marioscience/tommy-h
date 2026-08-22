import { query, logAudit } from '../db.js';
import { getServerByIdForUser } from './serverService.js';

export async function getSubusersForServer(serverId, userId, isAdmin = false) {
  const s = await getServerByIdForUser(serverId, userId, isAdmin, 'settings');
  if (!s) throw new Error('Servidor no encontrado o sin permisos');

  const { rows } = await query(`
    SELECT sub.id, sub.permissions, sub.created_at, u.id as user_id, u.username, u.email
    FROM subusers sub
    JOIN users u ON sub.user_id = u.id
    WHERE sub.server_id = $1
    ORDER BY sub.created_at ASC
  `, [serverId]);

  return rows;
}

export async function addSubuserToServer(serverId, userId, isAdmin, usernameOrEmail, permissions = ['restart', 'console']) {
  const s = await getServerByIdForUser(serverId, userId, isAdmin, 'settings');
  if (!s) throw new Error('Servidor no encontrado o sin permisos');

  if (s.owner_id !== userId && !isAdmin) {
    throw new Error('Solo el propietario del servidor puede añadir subusuarios');
  }

  const { rows: targetUsers } = await query(`
    SELECT id, username FROM users WHERE username = $1 OR email = $1
  `, [usernameOrEmail]);

  if (targetUsers.length === 0) {
    throw new Error('El usuario especificado no existe');
  }

  const targetUser = targetUsers[0];

  if (targetUser.id === s.owner_id) {
    throw new Error('No puedes añadirte a ti mismo como subusuario');
  }

  const { rows: existing } = await query(`
    SELECT id FROM subusers WHERE server_id = $1 AND user_id = $2
  `, [serverId, targetUser.id]);

  if (existing.length > 0) {
    throw new Error('Este usuario ya es subusuario de este servidor');
  }

  const validPermissions = ['start', 'stop', 'restart', 'console', 'files', 'settings', 'backups'];
  const sanitizedPermissions = permissions.filter(p => validPermissions.includes(p));

  const { rows } = await query(`
    INSERT INTO subusers (server_id, user_id, permissions)
    VALUES ($1, $2, $3)
    RETURNING id, permissions, created_at
  `, [serverId, targetUser.id, JSON.stringify(sanitizedPermissions)]);

  await logAudit(userId, 'subuser.add', { serverId, targetUserId: targetUser.id, permissions: sanitizedPermissions });

  return {
    id: rows[0].id,
    user_id: targetUser.id,
    username: targetUser.username,
    permissions: sanitizedPermissions,
    created_at: rows[0].created_at
  };
}

export async function removeSubuserFromServer(serverId, userId, isAdmin, subuserId) {
  const s = await getServerByIdForUser(serverId, userId, isAdmin, 'settings');
  if (!s) throw new Error('Servidor no encontrado o sin permisos');

  if (s.owner_id !== userId && !isAdmin) {
    throw new Error('Solo el propietario del servidor puede eliminar subusuarios');
  }

  const { rowCount } = await query(`
    DELETE FROM subusers WHERE id = $1 AND server_id = $2
  `, [subuserId, serverId]);

  if (rowCount === 0) {
    throw new Error('Subusuario no encontrado');
  }

  await logAudit(userId, 'subuser.remove', { serverId, subuserId });
  return { success: true };
}

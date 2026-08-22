import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, logAudit } from '../db.js';
import { signToken, setSessionCookie } from '../middleware/auth.js';
import { deleteServer } from '../services/serverService.js';

const router = express.Router();

router.post('/users/:id/reset-password', async (req, res) => {
    const { newPassword } = req.body || {};
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
    }
    try {
        const hash = await bcrypt.hash(newPassword, 12);
        await query('UPDATE users SET password_hash = $1, token_version = COALESCE(token_version, 0) + 1 WHERE id = $2', [hash, req.params.id]);
        await logAudit(req, 'admin.user.reset_password', { targetUserId: req.params.id });
        res.json({ success: true, message: 'Contraseña actualizada correctamente.' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/users', async (req, res) => {
  const { username, password, role, plan } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Faltan campos obligatorios' });

  const existing = await query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing.rowCount) return res.status(400).json({ error: 'El usuario ya existe' });

  const hash = await bcrypt.hash(password, 12);
  const targetRole = role === 'admin' ? 'admin' : 'client';
  const targetPlan = plan || 'hobby';

  await query('INSERT INTO users (username, password_hash, role, plan, is_verified) VALUES ($1, $2, $3, $4, true)',
              [username, hash, targetRole, targetPlan]);

  await logAudit(req, 'admin.user.create_manual', { createdUsername: username, targetRole });
  res.json({ success: true });
});

router.put('/users/:id', async (req, res) => {
  const { username, email, role, plan, password, expires_at } = req.body;
  const targetId = req.params.id;

  try {
    if (username) await query('UPDATE users SET username = $1 WHERE id = $2', [username, targetId]);
    if (email) await query('UPDATE users SET email = $1 WHERE id = $2', [email, targetId]);
    if (role && req.user.sub != targetId) await query('UPDATE users SET role = $1 WHERE id = $2', [role, targetId]);
    if (plan) await query('UPDATE users SET plan = $1 WHERE id = $2', [plan, targetId]);
    if (req.body.server_limit !== undefined) await query('UPDATE users SET server_limit = $1 WHERE id = $2', [req.body.server_limit, targetId]);
    if (expires_at !== undefined) {
      await query('UPDATE users SET expires_at = $1 WHERE id = $2', [expires_at, targetId]);
      await query('UPDATE servers SET expires_at = $1 WHERE owner_id = $2', [expires_at, targetId]);
    }
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, targetId]);
    }

    await logAudit(req, 'admin.user.updated', { targetUserId: targetId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el usuario' });
  }
});

router.get('/users', async (_req, res) => {
  const result = await query("SELECT id, username, email, role, plan, expires_at, is_verified, created_at FROM users ORDER BY created_at DESC");
  res.json({ items: result.rows });
});

router.delete('/users/:id', async (req, res) => {
  const userId = req.params.id;
  const userServers = await query('SELECT id FROM servers WHERE owner_id = $1', [userId]);

  for (const srv of userServers.rows) {
      await deleteServer(srv.id, userId, true);
  }

  await query('DELETE FROM users WHERE id = $1 AND role != $2', [userId, 'admin']);
  await logAudit(req, 'admin.user.delete', { targetUserId: userId });
  res.json({ success: true });
});

router.post('/users/:id/impersonate', async (req, res) => {
  const userId = req.params.id;
  const result = await query('SELECT id, username, email, role, is_verified, token_version FROM users WHERE id = $1', [userId]);
  if (!result.rowCount) return res.status(404).json({ error: 'Usuario no encontrado' });

  const user = result.rows[0];
  setSessionCookie(res, signToken(user));
  res.json({ user });
});

router.post('/invite-keys', async (req, res) => {
  const maxUses = req.body.maxUses || 1;
  const code = `RAGENODES-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const created = await query('INSERT INTO invite_keys (code, created_by, max_uses) VALUES ($1, $2, $3) RETURNING *', [code, req.user.sub, maxUses]);
  await logAudit(req, 'admin.invite_key.create', { code, maxUses });
  res.json({ inviteKey: created.rows[0] });
});

router.get('/invite-keys', async (_req, res) => {
  const result = await query('SELECT * FROM invite_keys ORDER BY created_at DESC');
  res.json({ items: result.rows });
});

router.delete('/invite-keys/:code', async (req, res) => {
  const { code } = req.params;
  await query('DELETE FROM invite_keys WHERE code = $1', [code]);
  res.json({ success: true });
});

export default router;

import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { logAudit, withTransaction } from '../db.js';
import { signToken, setSessionCookie } from '../middleware/auth.js';
import { deleteServer } from '../services/serverService.js';
import {
  createAdminUser,
  createInviteKey,
  deleteInviteKey,
  deleteNonAdminUser,
  findImpersonationUser,
  findUserIdByUsername,
  listAdminUsers,
  listInviteKeys,
  resetUserPassword,
  updateAdminUser
} from '../repositories/userRepository.js';
import { listServerIdsByOwner, updateOwnedServersExpiry } from '../repositories/serverRepository.js';

const router = express.Router();

router.post('/users/:id/reset-password', async (req, res) => {
    const { newPassword } = req.body || {};
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
    }
    try {
        const hash = await bcrypt.hash(newPassword, 12);
        await resetUserPassword(req.params.id, hash);
        await logAudit(req, 'admin.user.reset_password', { targetUserId: req.params.id });
        res.json({ success: true, message: 'Contraseña actualizada correctamente.' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/users', async (req, res) => {
  const { username, password, role, plan } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Faltan campos obligatorios' });

  if (await findUserIdByUsername(username)) return res.status(400).json({ error: 'El usuario ya existe' });

  const hash = await bcrypt.hash(password, 12);
  const targetRole = role === 'admin' ? 'admin' : 'client';
  const targetPlan = plan || 'hobby';

  await createAdminUser({ username, passwordHash: hash, role: targetRole, plan: targetPlan });

  await logAudit(req, 'admin.user.create_manual', { createdUsername: username, targetRole });
  res.json({ success: true });
});

router.put('/users/:id', async (req, res) => {
  const { username, email, role, plan, password, expires_at } = req.body;
  const targetId = req.params.id;

  try {
    const changes = {
      username: username || undefined,
      email: email || undefined,
      role: role && req.user.sub != targetId ? role : undefined,
      plan: plan || undefined,
      server_limit: req.body.server_limit,
      expires_at
    };
    if (password) {
      changes.password_hash = await bcrypt.hash(password, 12);
    }

    /** User expiry and owned-server expiry form one consistency boundary. */
    await withTransaction(async (tx) => {
      await updateAdminUser(targetId, changes, tx);
      if (expires_at !== undefined) await updateOwnedServersExpiry(targetId, expires_at, tx);
    });

    await logAudit(req, 'admin.user.updated', { targetUserId: targetId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el usuario' });
  }
});

router.get('/users', async (_req, res) => {
  res.json({ items: await listAdminUsers() });
});

router.delete('/users/:id', async (req, res) => {
  const userId = req.params.id;
  const serverIds = await listServerIdsByOwner(userId);
  for (const serverId of serverIds) {
      await deleteServer(serverId, userId, true);
  }

  await deleteNonAdminUser(userId);
  await logAudit(req, 'admin.user.delete', { targetUserId: userId });
  res.json({ success: true });
});

router.post('/users/:id/impersonate', async (req, res) => {
  const userId = req.params.id;
  const user = await findImpersonationUser(userId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  setSessionCookie(res, signToken(user));
  res.json({ user });
});

router.post('/invite-keys', async (req, res) => {
  const maxUses = req.body.maxUses || 1;
  const code = `RAGENODES-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const created = await createInviteKey({ code, createdBy: req.user.sub, maxUses });
  await logAudit(req, 'admin.invite_key.create', { code, maxUses });
  res.json({ inviteKey: created });
});

router.get('/invite-keys', async (_req, res) => {
  res.json({ items: await listInviteKeys() });
});

router.delete('/invite-keys/:code', async (req, res) => {
  const { code } = req.params;
  await deleteInviteKey(code);
  res.json({ success: true });
});

export default router;

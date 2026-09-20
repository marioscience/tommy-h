import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto'; // 🔥 IMPORTANTE: Necesario para generar tokens seguros
import { logAudit, withTransaction } from '../db.js';
import { signToken, setSessionCookie, clearSessionCookie, requireAuth } from '../middleware/auth.js'; // 🔥 Añadido requireAuth para la ruta de ajustes
import { sendWelcomeEmail, sendVerificationEmail, sendPasswordResetEmail } from '../services/emailService.js'; // 🔥 Todos los correos
import {
  completePasswordReset,
  consumeInviteKey,
  createRegisteredUser,
  findPublicUserProfile,
  findUserByEmail,
  findUserById,
  findUserByLogin,
  findUserByValidResetToken,
  findUserByVerificationToken,
  findUserIdByDiscordId,
  findUserIdByEmail,
  findVerificationProfile,
  linkDiscordId,
  markUserVerified,
  resetUserPassword,
  setPasswordReset,
  setVerificationToken,
  updateUserEmailVerification
} from '../repositories/userRepository.js';
import { loginRequest, registerRequest } from '../contracts/requestContracts.js';
import { validateRequest } from '../middleware/validateRequest.js';

const router = express.Router();
const DUMMY_PASSWORD_HASH = '$2a$12$83WzC23z2J7aw0o4AfUZG.kauDaz2kmF.y1QAbYMNgDG6IqYAMuDy';

function isValidUsername(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{3,32}$/.test(value);
}

function isValidEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidPassword(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128;
}

// ==========================================
// 🟢 LOGIN
// ==========================================
router.post('/login', validateRequest(loginRequest, { status: 401, error: 'Credenciales inválidas' }), async (req, res) => {
  const { username: identifier, password } = req.body;

  const user = await findUserByLogin(identifier);
  const passwordMatches = await bcrypt.compare(password, user?.password_hash || DUMMY_PASSWORD_HASH);
  if (!user || !passwordMatches) return res.status(401).json({ error: 'Credenciales inválidas' });

  await logAudit(user.id, 'auth.login');

  const token = signToken(user);
  setSessionCookie(res, token, req);
  const response = { token, user: { id: user.id, username: user.username, email: user.email, role: user.role, is_verified: user.is_verified } };
  res.json(response);
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

// ==========================================
// 🟢 REGISTRO (CON BETA KEY)
// ==========================================
router.post('/register', validateRequest(registerRequest, { error: 'Datos de registro inválidos.' }), async (req, res) => {
  const { username, email: normalizedEmail, password, inviteKey } = req.body;

  const hash = await bcrypt.hash(password, 12);
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + 1);

  // Generamos el token de verificación inicial
  const verifyToken = crypto.randomBytes(32).toString('hex');

  try {
    await withTransaction(async (tx) => {
      if (!await consumeInviteKey(inviteKey, tx)) throw new Error('INVITE_UNAVAILABLE');
      await createRegisteredUser({ username, email: normalizedEmail || null, passwordHash: hash, expiresAt, plan: 'hobby', verifyToken }, tx);
    });
  } catch (error) {
    if (error.message === 'INVITE_UNAVAILABLE') return res.status(400).json({ error: 'Invite Key inválida o agotada' });
    if (error.code === '23505') return res.status(400).json({ error: 'El usuario o correo ya están registrados.' });
    console.error('[auth.register]', error);
    return res.status(500).json({ error: 'No se pudo completar el registro.' });
  }

  // Disparamos los correos
  if (normalizedEmail) {
    void sendWelcomeEmail(normalizedEmail, username).catch(error => console.error('[auth.register] welcome email:', error.message));
    void sendVerificationEmail(normalizedEmail, username, verifyToken).catch(error => console.error('[auth.register] verification email:', error.message));
  }

  res.json({ success: true });
});

// ==========================================
// 🔒 RECUPERAR CONTRASEÑA (Paso 1: Enviar Email)
// ==========================================
router.post('/forgot-password', async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const user = isValidEmail(email) ? await findUserByEmail(email) : null;

    if (user) {

        // Generamos un token seguro de 64 caracteres
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expireDate = new Date();
        expireDate.setHours(expireDate.getHours() + 1); // Caduca en 1 hora

        // Guardamos el token en la BD
        await setPasswordReset(user.id, resetToken, expireDate);

        // Enviamos el correo
        await sendPasswordResetEmail(user.email, user.username, resetToken);
    }

    // Siempre decimos que fue "exitoso" por seguridad (para que no adivinen qué correos existen)
    res.json({ success: true, message: "Si el correo existe en nuestro sistema, hemos enviado las instrucciones." });
});

// ==========================================
// 🔒 RECUPERAR CONTRASEÑA (Paso 2: Cambiarla)
// ==========================================
router.post('/reset-password', async (req, res) => {
    const { token, newPassword } = req.body || {};

    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token) || !isValidPassword(newPassword)) {
        return res.status(400).json({ error: "El enlace o la nueva contraseña no son válidos." });
    }

    const user = await findUserByValidResetToken(token);
    if (!user) return res.status(400).json({ error: "El enlace es inválido o ha caducado." });
    const hash = await bcrypt.hash(newPassword, 12);

    // 🔥 MEJORA: Actualizamos la contraseña y SUMAMOS +1 al token_version para cerrar otras sesiones
    await completePasswordReset(user.id, hash);
    await logAudit(user.id, 'auth.password_reset');

    res.json({ success: true, message: "Contraseña actualizada correctamente. Ya puedes iniciar sesión." });
});

// ==========================================
// 📧 VALIDAR CORREO
// ==========================================
router.get('/verify', async (req, res) => {
    const { token } = req.query; // Viene por la URL (GET)

    if (!token) return res.status(400).send("Falta el token de verificación.");

    const user = await findUserByVerificationToken(token);
    if (!user) return res.status(400).send("Enlace de verificación inválido o ya utilizado.");
    await markUserVerified(user.id);

    // Redirigimos al panel con un flag de éxito en la URL para mostrar una notificación si quieres
    res.redirect('/panel?verified=true');
});

// ==========================================
// ⚙️ CAMBIAR CORREO/CONTRASEÑA DESDE EL PANEL
// ==========================================
router.post('/change-settings', requireAuth, async (req, res) => {
    const { currentPassword, newPassword, newEmail } = req.body;
    const userId = req.user.sub; // Sacado del token JWT

    const user = await findUserById(userId);

    if (typeof currentPassword !== 'string' || currentPassword.length > 128) {
        return res.status(400).json({ error: 'La contraseña actual es obligatoria.' });
    }
    if (newPassword && !isValidPassword(newPassword)) return res.status(400).json({ error: 'La nueva contraseña debe tener entre 8 y 128 caracteres.' });
    if (newEmail && !isValidEmail(String(newEmail).trim().toLowerCase())) return res.status(400).json({ error: 'El nuevo correo no es válido.' });

    // Siempre pedimos la contraseña actual por seguridad
    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
        return res.status(401).json({ error: 'La contraseña actual es incorrecta.' });
    }

    try {
        if (newPassword) {
            const hash = await bcrypt.hash(newPassword, 12);

            // 🔥 MEJORA: Actualizar contraseña y cerrar otras sesiones sumando +1 al token_version
            await resetUserPassword(userId, hash);
            await logAudit(userId, 'user.password_changed');
        }

        const normalizedNewEmail = newEmail ? String(newEmail).trim().toLowerCase() : '';
        if (normalizedNewEmail && normalizedNewEmail !== user.email) {
            // Verificar si el correo ya existe
            if (await findUserIdByEmail(normalizedNewEmail)) return res.status(400).json({ error: 'Ese correo ya está en uso.' });

            const verifyToken = crypto.randomBytes(32).toString('hex');

            // Actualizamos email, quitamos el verificado y asignamos nuevo token
            await updateUserEmailVerification(userId, normalizedNewEmail, verifyToken);

            await sendVerificationEmail(normalizedNewEmail, user.username, verifyToken);
            await logAudit(userId, 'user.email_changed');
        }

        res.json({ success: true, message: "Ajustes actualizados correctamente." });
    } catch (e) {
        res.status(500).json({ error: "Error interno al actualizar los ajustes." });
    }
});

// ==========================================
// 🔄 REENVIAR CORREO DE VERIFICACIÓN
// ==========================================
router.post('/resend-verification', requireAuth, async (req, res) => {
    const userId = req.user.sub;
    const user = await findVerificationProfile(userId);

    if (user.is_verified) return res.status(400).json({ error: "Tu cuenta ya está verificada." });

    const newToken = crypto.randomBytes(32).toString('hex');
    await setVerificationToken(userId, newToken);

    await sendVerificationEmail(user.email, user.username, newToken);

    res.json({ success: true, message: "Enlace de verificación reenviado. Revisa tu correo." });
});

// ==========================================
// 👤 OBTENER PERFIL ACTUAL (/api/auth/me)
// ==========================================
router.get('/me', requireAuth, async (req, res) => {
    try {
        const userId = req.user.sub;

        const user = await findPublicUserProfile(userId);
        if (!user) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        // Devolvemos el usuario "limpio" al frontend
        res.json(user);
    } catch (error) {
        console.error("Error en /api/auth/me:", error);
        res.status(500).json({ error: "Error al obtener perfil del usuario" });
    }
});

// ==========================================
// 👾 VINCULAR CUENTA DE DISCORD (NUEVA RUTA)
// ==========================================
router.post('/link-discord', requireAuth, async (req, res) => {
    const { discordId } = req.body;
    const userId = req.user.sub;

    if (typeof discordId !== 'string' || !/^\d{17,20}$/.test(discordId)) {
        return res.status(400).json({ error: 'El ID de Discord es obligatorio.' });
    }

    try {
        // Verificar si ese ID de Discord ya está en uso por otro usuario diferente
        const linkedUserId = await findUserIdByDiscordId(discordId);
        if (linkedUserId && linkedUserId !== userId) {
            return res.status(400).json({ error: 'Este ID de Discord ya está vinculado a otra cuenta.' });
        }

        // Actualizamos el discord_id del usuario
        if (!await linkDiscordId(userId, discordId)) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }

        await logAudit(userId, 'user.discord_linked');

        res.json({ success: true, message: "Cuenta de Discord vinculada con éxito." });
    } catch (e) {
        console.error("Error en /api/auth/link-discord:", e);
        res.status(500).json({ error: "Error interno al vincular Discord." });
    }
});

export default router;

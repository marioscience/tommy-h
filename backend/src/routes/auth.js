import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto'; // 🔥 IMPORTANTE: Necesario para generar tokens seguros
import { query, logAudit, withTransaction } from '../db.js';
import { signToken, setSessionCookie, clearSessionCookie, requireAuth } from '../middleware/auth.js'; // 🔥 Añadido requireAuth para la ruta de ajustes
import { sendWelcomeEmail, sendVerificationEmail, sendPasswordResetEmail } from '../services/emailService.js'; // 🔥 Todos los correos

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
router.post('/login', async (req, res) => {
  console.log('🔑 [LOGIN_BODY]:', req.body);
  const { username, password } = req.body || {};
  const identifier = String(username || '').trim();
  console.log(`🔑 [LOGIN_ATTEMPT] identifier="${identifier}", pwd_len=${password ? password.length : 0}`);
  if (!identifier || typeof password !== 'string' || password.length > 128) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const result = await query('SELECT * FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)', [identifier]);
  const user = result.rows[0];
  const passwordMatches = await bcrypt.compare(password, user?.password_hash || DUMMY_PASSWORD_HASH);
  if (!user || !passwordMatches) return res.status(401).json({ error: 'Credenciales inválidas' });

  await logAudit(user.id, 'auth.login');

  const token = signToken(user);
  setSessionCookie(res, token, req);
  const response = { user: { id: user.id, username: user.username, email: user.email, role: user.role, is_verified: user.is_verified } };
  if (req.get('X-Auth-Mode') === 'bearer') response.token = token;
  res.json(response);
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

// ==========================================
// 🟢 REGISTRO (CON BETA KEY)
// ==========================================
router.post('/register', async (req, res) => {
  const { username, email, password, inviteKey } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!isValidUsername(username) || (normalizedEmail && !isValidEmail(normalizedEmail)) || !isValidPassword(password) || typeof inviteKey !== 'string' || inviteKey.length > 128) {
    return res.status(400).json({ error: 'Datos de registro inválidos.' });
  }

  const hash = await bcrypt.hash(password, 12);
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + 1);

  // Generamos el token de verificación inicial
  const verifyToken = crypto.randomBytes(32).toString('hex');

  try {
    await withTransaction(async (tx) => {
      const invite = await tx(
        'UPDATE invite_keys SET uses = uses + 1 WHERE code = $1 AND uses < max_uses RETURNING id',
        [inviteKey]
      );
      if (invite.rowCount === 0) throw new Error('INVITE_UNAVAILABLE');

      await tx(
        'INSERT INTO users (username, email, password_hash, expires_at, plan, verify_token) VALUES ($1, $2, $3, $4, $5, $6)',
        [username, normalizedEmail || null, hash, expiresAt, 'hobby', verifyToken]
      );
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
    const userResult = isValidEmail(email)
        ? await query('SELECT * FROM users WHERE email = $1', [email])
        : { rowCount: 0, rows: [] };

    if (userResult.rowCount > 0) {
        const user = userResult.rows[0];

        // Generamos un token seguro de 64 caracteres
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expireDate = new Date();
        expireDate.setHours(expireDate.getHours() + 1); // Caduca en 1 hora

        // Guardamos el token en la BD
        await query('UPDATE users SET reset_token = $1, reset_expires = $2 WHERE id = $3', [resetToken, expireDate, user.id]);

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

    const userResult = await query('SELECT * FROM users WHERE reset_token = $1 AND reset_expires > NOW()', [token]);
    if (userResult.rowCount === 0) return res.status(400).json({ error: "El enlace es inválido o ha caducado." });

    const user = userResult.rows[0];
    const hash = await bcrypt.hash(newPassword, 12);

    // 🔥 MEJORA: Actualizamos la contraseña y SUMAMOS +1 al token_version para cerrar otras sesiones
    await query('UPDATE users SET password_hash = $1, reset_token = NULL, reset_expires = NULL, token_version = token_version + 1 WHERE id = $2', [hash, user.id]);
    await logAudit(user.id, 'auth.password_reset');

    res.json({ success: true, message: "Contraseña actualizada correctamente. Ya puedes iniciar sesión." });
});

// ==========================================
// 📧 VALIDAR CORREO
// ==========================================
router.get('/verify', async (req, res) => {
    const { token } = req.query; // Viene por la URL (GET)

    if (!token) return res.status(400).send("Falta el token de verificación.");

    const userResult = await query('SELECT * FROM users WHERE verify_token = $1', [token]);
    if (userResult.rowCount === 0) return res.status(400).send("Enlace de verificación inválido o ya utilizado.");

    await query('UPDATE users SET is_verified = true, verify_token = NULL WHERE id = $1', [userResult.rows[0].id]);

    // Redirigimos al panel con un flag de éxito en la URL para mostrar una notificación si quieres
    res.redirect('/panel?verified=true');
});

// ==========================================
// ⚙️ CAMBIAR CORREO/CONTRASEÑA DESDE EL PANEL
// ==========================================
router.post('/change-settings', requireAuth, async (req, res) => {
    const { currentPassword, newPassword, newEmail } = req.body;
    const userId = req.user.sub; // Sacado del token JWT

    const userResult = await query('SELECT * FROM users WHERE id = $1', [userId]);
    const user = userResult.rows[0];

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
            await query('UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2', [hash, userId]);
            await logAudit(userId, 'user.password_changed');
        }

        const normalizedNewEmail = newEmail ? String(newEmail).trim().toLowerCase() : '';
        if (normalizedNewEmail && normalizedNewEmail !== user.email) {
            // Verificar si el correo ya existe
            const emailCheck = await query('SELECT id FROM users WHERE email = $1', [normalizedNewEmail]);
            if (emailCheck.rowCount > 0) return res.status(400).json({ error: 'Ese correo ya está en uso.' });

            const verifyToken = crypto.randomBytes(32).toString('hex');

            // Actualizamos email, quitamos el verificado y asignamos nuevo token
            await query('UPDATE users SET email = $1, is_verified = false, verify_token = $2 WHERE id = $3', [normalizedNewEmail, verifyToken, userId]);

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
    const userResult = await query('SELECT username, email, is_verified FROM users WHERE id = $1', [userId]);
    const user = userResult.rows[0];

    if (user.is_verified) return res.status(400).json({ error: "Tu cuenta ya está verificada." });

    const newToken = crypto.randomBytes(32).toString('hex');
    await query('UPDATE users SET verify_token = $1 WHERE id = $2', [newToken, userId]);

    await sendVerificationEmail(user.email, user.username, newToken);

    res.json({ success: true, message: "Enlace de verificación reenviado. Revisa tu correo." });
});

// ==========================================
// 👤 OBTENER PERFIL ACTUAL (/api/auth/me)
// ==========================================
router.get('/me', requireAuth, async (req, res) => {
    try {
        const userId = req.user.sub;

        const result = await query(
            'SELECT id, username, email, role, plan, is_verified, discord_id FROM users WHERE id = $1',
            [userId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        // Devolvemos el usuario "limpio" al frontend
        res.json(result.rows[0]);
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
        const checkResult = await query('SELECT id FROM users WHERE discord_id = $1', [discordId]);
        if (checkResult.rowCount > 0 && checkResult.rows[0].id !== userId) {
            return res.status(400).json({ error: 'Este ID de Discord ya está vinculado a otra cuenta.' });
        }

        // Actualizamos el discord_id del usuario
        const result = await query(
            'UPDATE users SET discord_id = $1 WHERE id = $2 RETURNING id',
            [discordId, userId]
        );

        if (result.rowCount === 0) {
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

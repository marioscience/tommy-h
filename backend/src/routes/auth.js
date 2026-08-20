import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto'; // 🔥 IMPORTANTE: Necesario para generar tokens seguros
import { query, logAudit } from '../db.js';
import { signToken, requireAuth } from '../middleware/auth.js'; // 🔥 Añadido requireAuth para la ruta de ajustes
import { sendWelcomeEmail, sendVerificationEmail, sendPasswordResetEmail } from '../services/emailService.js'; // 🔥 Todos los correos

const router = express.Router();

// ==========================================
// 🟢 LOGIN
// ==========================================
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const result = await query('SELECT * FROM users WHERE username = $1', [username]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Credenciales inválidas' });

  await logAudit(user.id, 'auth.login');

  // 🔥 MEJORA: Enviamos el email y el estado de verificación al frontend
  res.json({ token: signToken(user), user: { id: user.id, username: user.username, email: user.email, role: user.role, is_verified: user.is_verified } });
});

// ==========================================
// 🟢 REGISTRO (CON BETA KEY)
// ==========================================
router.post('/register', async (req, res) => {
  const { username, email, password, inviteKey } = req.body;

  const invite = await query('SELECT * FROM invite_keys WHERE code = $1 AND uses < max_uses', [inviteKey]);
  if (!invite.rowCount) return res.status(400).json({ error: 'Invite Key inválida o agotada' });

  const existing = await query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing.rowCount) return res.status(400).json({ error: 'Usuario ya existe' });

  if (email) {
      const existingEmail = await query('SELECT id FROM users WHERE email = $1', [email]);
      if (existingEmail.rowCount) return res.status(400).json({ error: 'Este correo electrónico ya está en uso' });
  }

  const hash = await bcrypt.hash(password, 12);
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + 1);

  // Generamos el token de verificación inicial
  const verifyToken = crypto.randomBytes(32).toString('hex');

  // Guardamos el usuario con su token y plan hobby
  await query(
      'INSERT INTO users (username, email, password_hash, expires_at, plan, verify_token) VALUES ($1, $2, $3, $4, $5, $6)',
      [username, email, hash, expiresAt, 'hobby', verifyToken]
  );

  await query('UPDATE invite_keys SET uses = uses + 1 WHERE id = $1', [invite.rows[0].id]);

  // Disparamos los correos
  if (email) {
      sendWelcomeEmail(email, username);
      sendVerificationEmail(email, username, verifyToken); // 🔥 Correo de verificación enviado
  }

  res.json({ success: true });
});

// ==========================================
// 🔒 RECUPERAR CONTRASEÑA (Paso 1: Enviar Email)
// ==========================================
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    const userResult = await query('SELECT * FROM users WHERE email = $1', [email]);

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
    const { token, newPassword } = req.body;

    if (!token || !newPassword) return res.status(400).json({ error: "Faltan datos." });
    if (newPassword.length < 6) return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });

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

    // Siempre pedimos la contraseña actual por seguridad
    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
        return res.status(401).json({ error: 'La contraseña actual es incorrecta.' });
    }

    try {
        if (newPassword) {
            if (newPassword.length < 6) return res.status(400).json({ error: 'La nueva contraseña es muy corta.' });
            const hash = await bcrypt.hash(newPassword, 12);

            // 🔥 MEJORA: Actualizar contraseña y cerrar otras sesiones sumando +1 al token_version
            await query('UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2', [hash, userId]);
            await logAudit(userId, 'user.password_changed');
        }

        if (newEmail && newEmail !== user.email) {
            // Verificar si el correo ya existe
            const emailCheck = await query('SELECT id FROM users WHERE email = $1', [newEmail]);
            if (emailCheck.rowCount > 0) return res.status(400).json({ error: 'Ese correo ya está en uso.' });

            const verifyToken = crypto.randomBytes(32).toString('hex');

            // Actualizamos email, quitamos el verificado y asignamos nuevo token
            await query('UPDATE users SET email = $1, is_verified = false, verify_token = $2 WHERE id = $3', [newEmail, verifyToken, userId]);

            await sendVerificationEmail(newEmail, user.username, verifyToken);
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

    if (!discordId) {
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

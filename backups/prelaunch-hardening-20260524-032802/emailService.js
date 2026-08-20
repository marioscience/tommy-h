// backend/src/services/emailService.js
import { Resend } from 'resend';

export const RESEND_API_KEY = "[REMOVED_RESEND_API_KEY]";
export const EMAIL_FROM = "RageNodes <info@ragenodes.com>";

// 🔥 EXPORTAMOS LA INSTANCIA PARA QUE tickets.js FUNCIONE
export const resend = new Resend(RESEND_API_KEY);

/**
 * 📧 Correo de Bienvenida
 */
export async function sendWelcomeEmail(toEmail, username) {
    if (!toEmail) return;
    try {
        await resend.emails.send({
            from: EMAIL_FROM,
            to: [toEmail],
            subject: '🚀 ¡Bienvenido a RageNodes!',
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #09090b; color: #fff; padding: 30px; border-radius: 12px; border: 1px solid #333;">
                    <h2 style="color: #6366f1;">¡Hola, ${username}! Bienvenido a RageNodes.</h2>
                    <p style="color: #a1a1aa; font-size: 16px; line-height: 1.5;">Tu cuenta ha sido creada exitosamente. Ya puedes acceder a tu panel de control y desplegar tu servidor FiveM en cuestión de segundos.</p>
                    <div style="text-align: center; margin-top: 30px;">
                        <a href="https://ragenodes.com/panel" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Acceder al Panel</a>
                    </div>
                </div>
            `
        });
        console.log(`📧 Correo de bienvenida enviado a ${toEmail}`);
    } catch (error) {
        console.error(`❌ Error en sendWelcomeEmail:`, error);
    }
}

/**
 * 📧 Correo de Verificación de Cuenta
 */
export async function sendVerificationEmail(toEmail, username, verifyToken) {
    if (!toEmail || !verifyToken) return;
    const verifyLink = `https://ragenodes.com/verify?token=${verifyToken}`;
    try {
        await resend.emails.send({
            from: EMAIL_FROM,
            to: [toEmail],
            subject: '✅ Verifica tu correo en RageNodes',
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #09090b; color: #fff; padding: 30px; border-radius: 12px; border: 1px solid #333;">
                    <h2 style="color: #10b981;">Verificación de Correo Electrónico</h2>
                    <p style="color: #a1a1aa; font-size: 16px; line-height: 1.5;">Hola, ${username}. Por seguridad, necesitamos verificar que esta dirección de correo te pertenece.</p>
                    <div style="text-align: center; margin-top: 30px; margin-bottom: 20px;">
                        <a href="${verifyLink}" style="background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Verificar mi Correo</a>
                    </div>
                    <p style="color: #666; font-size: 12px;">Si el botón no funciona, copia y pega esto: <br>${verifyLink}</p>
                </div>
            `
        });
        console.log(`📧 Correo de verificación enviado a ${toEmail}`);
    } catch (error) {
        console.error(`❌ Error en sendVerificationEmail:`, error);
    }
}

/**
 * 📧 Correo de Recuperación de Contraseña
 */
export async function sendPasswordResetEmail(toEmail, username, resetToken) {
    if (!toEmail || !resetToken) return;
    const resetLink = `https://ragenodes.com/reset-password?token=${resetToken}`;
    try {
        await resend.emails.send({
            from: EMAIL_FROM,
            to: [toEmail],
            subject: '🔒 Recuperación de contraseña - RageNodes',
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #09090b; color: #fff; padding: 30px; border-radius: 12px; border: 1px solid #333;">
                    <h2 style="color: #f59e0b;">Recuperación de Contraseña</h2>
                    <p style="color: #a1a1aa; font-size: 16px; line-height: 1.5;">Hola, ${username}. Haz clic abajo para restablecer tu contraseña. El enlace caduca en 1 hora.</p>
                    <div style="text-align: center; margin-top: 30px; margin-bottom: 20px;">
                        <a href="${resetLink}" style="background: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Restablecer Contraseña</a>
                    </div>
                </div>
            `
        });
        console.log(`📧 Correo de reset enviado a ${toEmail}`);
    } catch (error) {
        console.error(`❌ Error en sendPasswordResetEmail:`, error);
    }
}

/**
 * 📧 Correo de Invitación al Equipo (Auto-Registro)
 */
export async function sendTeamInviteEmail(toEmail, username, password, serverName, ownerUsername) {
    if (!toEmail) return;
    try {
        await resend.emails.send({
            from: EMAIL_FROM,
            to: [toEmail],
            subject: `🤝 ${ownerUsername} te ha invitado a su equipo en RageNodes`,
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #09090b; color: #fff; padding: 30px; border-radius: 12px; border: 1px solid #333;">
                    <h2 style="color: #38bdf8;">¡Has sido invitado al equipo de ${ownerUsername}!</h2>
                    <p style="color: #a1a1aa; font-size: 16px; line-height: 1.5;">
                        Hola, <strong>${username}</strong>. Se te ha otorgado acceso para gestionar el servidor <strong>${serverName}</strong> en la plataforma RageNodes.
                    </p>
                    <div style="background: rgba(56, 189, 248, 0.1); border-left: 4px solid #38bdf8; padding: 15px; margin: 25px 0; border-radius: 6px;">
                        <p style="margin: 0 0 10px 0; color: #e0f2fe; font-size: 14px;">Hemos creado tu cuenta de equipo automáticamente con los siguientes datos:</p>
                        <p style="margin: 5px 0; font-family: monospace; font-size: 16px;"><strong>Usuario / Email:</strong> ${toEmail}</p>
                        <p style="margin: 5px 0; font-family: monospace; font-size: 16px;"><strong>Contraseña temporal:</strong> ${password}</p>
                    </div>
                    <p style="color: #a1a1aa; font-size: 14px;">Te recomendamos cambiar tu contraseña desde los ajustes del panel una vez inicies sesión.</p>
                    <div style="text-align: center; margin-top: 35px;">
                        <a href="https://ragenodes.com/panel" style="background: #38bdf8; color: #000; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Acceder al Panel de Control</a>
                    </div>
                </div>
            `
        });
        console.log(`📧 Correo de invitación de equipo enviado a ${toEmail}`);
    } catch (error) {
        console.error(`❌ Error en sendTeamInviteEmail:`, error);
    }
}

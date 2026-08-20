import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query, logAudit } from '../db.js';
import { resend } from '../services/emailService.js'; // Usamos la instancia de Resend

const router = express.Router();

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
}

// 🟢 CREAR UN TICKET (Envío de correo a soporte)
router.post('/create', requireAuth, async (req, res) => {
    const { subject, message } = req.body;
    const userId = req.user.sub;

    if (typeof subject !== 'string' || typeof message !== 'string' || !subject.trim() || !message.trim()
        || subject.length > 160 || message.length > 10_000) {
        return res.status(400).json({ error: 'Asunto y mensaje son obligatorios.' });
    }

    try {
        // Obtenemos los datos del usuario para saber quién escribe
        const userResult = await query('SELECT username, email FROM users WHERE id = $1', [userId]);
        const user = userResult.rows[0];

        // 1. Enviamos el correo a TU cuenta de soporte
        await resend.emails.send({
            from: 'RageNodes Support <system@ragenodes.com>',
            to: 'soporte@ragenodes.com', // 📧 Aquí recibes tú los tickets
            subject: `[TICKET] ${subject.replace(/[\r\n]/g, ' ')} - @${user.username}`,
            html: `
                <div style="font-family: sans-serif; color: #333;">
                    <h2>Nuevo Ticket de Soporte</h2>
                    <p><strong>Usuario:</strong> ${escapeHtml(user.username)} (${escapeHtml(user.email)})</p>
                    <p><strong>Asunto:</strong> ${escapeHtml(subject)}</p>
                    <hr />
                    <p><strong>Mensaje:</strong></p>
                    <div style="background: #f4f4f4; padding: 15px; border-radius: 8px;">
                        ${escapeHtml(message).replace(/\n/g, '<br>')}
                    </div>
                    <hr />
                    <p style="font-size: 0.8rem; color: #888;">Este es un mensaje automático del sistema de RageNodes.</p>
                </div>
            `
        });

        // 2. Auditamos la acción
        await logAudit(userId, 'user.ticket_sent', { subject });

        res.json({ success: true, message: 'Ticket enviado con éxito. Te responderemos pronto.' });

    } catch (error) {
        console.error("Error al procesar ticket:", error);
        res.status(500).json({ error: 'No se pudo enviar el ticket. Inténtalo más tarde.' });
    }
});

export default router;

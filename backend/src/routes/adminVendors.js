import express from 'express';
import { query } from '../db.js';

const router = express.Router();

// ==========================================
// VENDOR MANAGEMENT FROM PANEL
// ==========================================
router.get('/vendors', async (req, res) => {
    try {
        const result = await query(`
            SELECT v.id, v.user_id, v.discord_username, v.portfolio_url, v.experience_summary, v.status, v.created_at, u.username as web_username
            FROM vendor_applications v
            LEFT JOIN users u ON v.user_id = u.id
            ORDER BY v.created_at DESC LIMIT 50
        `);
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo postulaciones' });
    }
});

router.post('/vendor/:appId/action', async (req, res) => {
    const { action } = req.body; // 'accepted', 'rejected', 'revoke'
    const appId = req.params.appId;

    if (!['accepted', 'rejected', 'revoke'].includes(action)) return res.status(400).json({ error: 'Acción inválida' });

    try {
        const app = await query('SELECT user_id FROM vendor_applications WHERE id = $1', [appId]);
        if (app.rowCount === 0) return res.status(404).json({ error: 'No encontrado' });

        if (action === 'revoke') {
            await query("UPDATE vendor_applications SET status = 'rejected' WHERE id = $1", [appId]);
            await query('UPDATE users SET role = $1 WHERE id = $2 AND role = $3', ['client', app.rows[0].user_id, 'vendor']);
            return res.json({ success: true, message: 'Permisos de vendedor revocados' });
        }

        await query('UPDATE vendor_applications SET status = $1 WHERE id = $2', [action, appId]);

        if (action === 'accepted') {
            await query('UPDATE users SET role = $1 WHERE id = $2 AND role = $3', ['vendor', app.rows[0].user_id, 'client']);
        }
        res.json({ success: true, message: `Vendedor ${action === 'accepted' ? 'aprobado' : 'rechazado'}` });
    } catch (e) {
        console.error("Error en vendor action:", e);
        res.status(500).json({ error: 'Error procesando la solicitud' });
    }
});

export default router;

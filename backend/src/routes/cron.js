import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db.js';
import { getServerByIdForUser } from '../services/serverService.js';
import { logAudit } from '../db.js';

const router = express.Router();

router.use(requireAuth);

// Obtener tareas programadas de un servidor
router.get('/:serverId', async (req, res) => {
    try {
        const s = await getServerByIdForUser(req.params.serverId, req.user.sub, req.user.role === 'admin');
        if (!s) return res.status(404).json({ error: 'Servidor no encontrado' });

        const result = await query(
            'SELECT id, time_hh_mm, action, payload, created_at FROM server_cron_jobs WHERE server_id = $1 ORDER BY time_hh_mm ASC',
            [req.params.serverId]
        );
        res.json({ items: result.rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Crear una nueva tarea
router.post('/:serverId', async (req, res) => {
    try {
        const { time_hh_mm, action, payload } = req.body;
        if (!time_hh_mm || !action) return res.status(400).json({ error: 'Faltan campos requeridos' });

        const s = await getServerByIdForUser(req.params.serverId, req.user.sub, req.user.role === 'admin');
        if (!s) return res.status(404).json({ error: 'Servidor no encontrado' });

        const result = await query(
            'INSERT INTO server_cron_jobs (server_id, time_hh_mm, action, payload) VALUES ($1, $2, $3, $4) RETURNING id, time_hh_mm, action, payload',
            [req.params.serverId, time_hh_mm, action, payload || null]
        );

        await logAudit(req, 'server.cron.create', { serverId: req.params.serverId, action, time_hh_mm });
        res.status(201).json({ item: result.rows[0] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Eliminar una tarea
router.delete('/:serverId/:jobId', async (req, res) => {
    try {
        const s = await getServerByIdForUser(req.params.serverId, req.user.sub, req.user.role === 'admin');
        if (!s) return res.status(404).json({ error: 'Servidor no encontrado' });

        const result = await query(
            'DELETE FROM server_cron_jobs WHERE id = $1 AND server_id = $2 RETURNING id',
            [req.params.jobId, req.params.serverId]
        );

        if (result.rowCount === 0) return res.status(404).json({ error: 'Tarea no encontrada' });

        await logAudit(req, 'server.cron.delete', { serverId: req.params.serverId, jobId: req.params.jobId });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as ServerService from '../services/serverService.js';
import * as ZomboidService from '../services/zomboidService.js';
import { logAudit } from '../db.js';

const router = express.Router();

// 🛠️ Obtener configuración visual de Project Zomboid
router.get('/config/:id', requireAuth, async (req, res) => {
    try {
        const s = await ServerService.getServerByIdForUser(req.params.id, req.user.sub, req.user.role === 'admin', 'files');
        if (!s) return res.status(404).json({ error: 'No encontrado' });
        const config = await ZomboidService.getZomboidConfig(s.data_path);
        res.json(config);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 💾 Guardar configuración visual de Project Zomboid
router.post('/config/:id', requireAuth, async (req, res) => {
    try {
        const s = await ServerService.getServerByIdForUser(req.params.id, req.user.sub, req.user.role === 'admin', 'files');
        if (!s) return res.status(404).json({ error: 'No encontrado' });
        await ZomboidService.saveZomboidConfig(s.data_path, req.body);
        await logAudit(req, 'update_zomboid_config', { serverId: req.params.id });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;

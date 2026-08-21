import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as ServerService from '../services/serverService.js';
import * as PalworldService from '../services/palworldService.js';

const router = express.Router();

// 🛠️ Obtener configuración visual de Palworld
router.get('/config/:id', requireAuth, async (req, res) => {
    try {
        const s = await ServerService.getServerByIdForUser(req.params.id, req.user.sub, req.user.role === 'admin', 'files');
        if (!s) return res.status(404).json({ error: "No encontrado" });
        const config = await PalworldService.getPalworldConfig(s.data_path);
        res.json(config);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 💾 Guardar configuración visual de Palworld
router.post('/config/:id', requireAuth, async (req, res) => {
    try {
        const s = await ServerService.getServerByIdForUser(req.params.id, req.user.sub, req.user.role === 'admin', 'files');
        if (!s) return res.status(404).json({ error: "No encontrado" });
        await PalworldService.savePalworldConfig(s.data_path, req.body);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;

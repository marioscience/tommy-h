import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as ServerService from '../services/serverService.js';
import * as ARKService from '../services/arkService.js';

const router = express.Router();

// ✅ Verificar si un plan cumple los requisitos de ARK
router.get('/requirements/:planName', requireAuth, async (req, res) => {
    try {
        const result = ARKService.checkArkRequirements(req.params.planName);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 🛠️ Obtener configuración visual de ARK
router.get('/config/:id', requireAuth, async (req, res) => {
    try {
        const s = await ServerService.getServerByIdForUser(req.params.id, req.user.sub, req.user.role === 'admin', 'files');
        if (!s) return res.status(404).json({ error: 'No encontrado' });
        const config = await ARKService.getARKConfig(s.data_path);
        res.json(config);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 💾 Guardar configuración visual de ARK
router.post('/config/:id', requireAuth, async (req, res) => {
    try {
        const s = await ServerService.getServerByIdForUser(req.params.id, req.user.sub, req.user.role === 'admin', 'files');
        if (!s) return res.status(404).json({ error: 'No encontrado' });
        await ARKService.saveARKConfig(s.data_path, req.body, s.cluster_id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;

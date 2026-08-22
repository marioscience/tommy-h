import express from 'express';
import { getSDTDConfig, saveSDTDConfig } from '../services/sdtdService.js';
import { logAudit } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getServerByIdForUser } from '../services/serverService.js';

const router = express.Router();

router.get('/config/:id', requireAuth, async (req, res) => {
    try {
        const server = await getServerByIdForUser(req.params.id, req.user.sub, req.user.role === 'admin', 'files');
        if (!server) return res.status(404).json({ error: 'Server not found' });
        
        const config = await getSDTDConfig(server.data_path);
        res.json(config);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/config/:id', requireAuth, async (req, res) => {
    try {
        const server = await getServerByIdForUser(req.params.id, req.user.sub, req.user.role === 'admin', 'files');
        if (!server) return res.status(404).json({ error: 'Server not found' });
        
        await saveSDTDConfig(server.data_path, req.body);
        await logAudit(req, 'update_sdtd_config', { serverId: req.params.id });
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;

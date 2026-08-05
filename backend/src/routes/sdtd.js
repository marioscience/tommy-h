import express from 'express';
import { query } from '../db.js';
import { getSDTDConfig, saveSDTDConfig } from '../services/sdtdService.js';
import { logAudit } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/config/:id', requireAuth, async (req, res) => {
    try {
        const server = await query('SELECT * FROM servers WHERE id = $1', [req.params.id]);
        if (!server.rowCount) return res.status(404).json({ error: 'Server not found' });
        
        const config = await getSDTDConfig(server.rows[0].data_path);
        res.json(config);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/config/:id', requireAuth, async (req, res) => {
    try {
        const server = await query('SELECT * FROM servers WHERE id = $1', [req.params.id]);
        if (!server.rowCount) return res.status(404).json({ error: 'Server not found' });
        
        await saveSDTDConfig(server.rows[0].data_path, req.body);
        await logAudit(req, 'update_sdtd_config', { serverId: req.params.id });
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;

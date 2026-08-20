import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as modService from '../services/minecraftModService.js';
import { logAudit } from '../db.js';

const router = express.Router();

// Buscar mods
router.get('/:serverId/search', requireAuth, async (req, res) => {
    try {
        const { q } = req.query;
        const results = await modService.searchMods(q || "");
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener versiones de un mod
router.get('/:serverId/project/:modId/versions', requireAuth, async (req, res) => {
    try {
        const { modId } = req.params;
        const versions = await modService.getModVersions(modId);
        res.json(versions);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Instalar un mod
router.post('/:serverId/install', requireAuth, async (req, res) => {
    try {
        const { serverId } = req.params;
        const { versionId, modName } = req.body;
        
        if (!versionId) return res.status(400).json({ error: 'Falta el ID de versión' });

        const result = await modService.installMod(serverId, req.user.sub, req.user.role === 'admin', versionId);
        
        await logAudit(req.user.sub, 'MINECRAFT.MOD.INSTALL', { serverId, modName, versionId, fileName: result.fileName });

        res.json({ success: true, message: `Mod ${result.fileName} instalado correctamente.` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;

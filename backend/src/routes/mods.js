import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as modService from '../services/modService.js';
import { logAudit } from '../db.js';

const router = express.Router();

// Listar mods instalados en el servidor
router.get('/:serverId', requireAuth, async (req, res) => {
    try {
        const { serverId } = req.params;
        const data = await modService.getGameMods(serverId, req.user.sub, req.user.role === 'admin');
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Instalar mod de Zomboid
router.post('/:serverId/zomboid/install', requireAuth, async (req, res) => {
    try {
        const { serverId } = req.params;
        const { workshopId, modName } = req.body;
        const result = await modService.installZomboidMod(serverId, req.user.sub, req.user.role === 'admin', workshopId, modName);
        await logAudit(req.user.sub, 'ZOMBOID.MOD.INSTALL', { serverId, workshopId, modName });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Instalar plugin de Rust
router.post('/:serverId/rust/install', requireAuth, async (req, res) => {
    try {
        const { serverId } = req.params;
        const { pluginUrl, pluginName } = req.body;
        const result = await modService.installRustPlugin(serverId, pluginUrl, pluginName);
        await logAudit(req.user.sub, 'RUST.MOD.INSTALL', { serverId, pluginName });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Instalar mod de ARK
router.post('/:serverId/ark/install', requireAuth, async (req, res) => {
    try {
        const { serverId } = req.params;
        const { modId } = req.body;
        const result = await modService.installArkMod(serverId, modId);
        await logAudit(req.user.sub, 'ARK.MOD.INSTALL', { serverId, modId });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Buscar mods de ARK
router.get('/:serverId/ark/search', requireAuth, async (req, res) => {
    try {
        const { q } = req.query;
        const results = await modService.searchArkMods(q || "");
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Buscar mods de Valheim
router.get('/:serverId/valheim/search', requireAuth, async (req, res) => {
    try {
        const { q } = req.query;
        const results = await modService.searchValheimMods(q || "");
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Buscar mods de Palworld
router.get('/:serverId/palworld/search', requireAuth, async (req, res) => {
    try {
        const { q } = req.query;
        const results = await modService.searchPalworldMods(q || "");
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Buscar mods de 7DTD
router.get('/:serverId/sdtd/search', requireAuth, async (req, res) => {
    try {
        const { q } = req.query;
        const results = await modService.searchSDTDMods(q || "");
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;

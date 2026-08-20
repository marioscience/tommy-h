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
        if (!/^\d{1,20}$/.test(String(workshopId)) || !/^[\w .-]{1,80}$/u.test(String(modName))) {
            return res.status(400).json({ error: 'Identificador o nombre de mod inválido.' });
        }
        const result = await modService.installZomboidMod(serverId, req.user.sub, req.user.role === 'admin', workshopId, modName);
        await logAudit(req.user.sub, 'ZOMBOID.MOD.INSTALL', { serverId, workshopId, modName });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Desinstalar mod de Zomboid
router.post('/:serverId/zomboid/uninstall', requireAuth, async (req, res) => {
    try {
        const { serverId } = req.params;
        const { workshopId, modName } = req.body;
        if (!/^\d{1,20}$/.test(String(workshopId)) || !/^[\w .-]{1,80}$/u.test(String(modName))) {
            return res.status(400).json({ error: 'Identificador o nombre de mod inválido.' });
        }
        const result = await modService.uninstallZomboidMod(serverId, req.user.sub, req.user.role === 'admin', workshopId, modName);
        await logAudit(req.user.sub, 'ZOMBOID.MOD.UNINSTALL', { serverId, workshopId, modName });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener imagen de Steam Workshop
router.get('/steam-image/:workshopId', async (req, res) => {
    try {
        const response = await fetch(`https://steamcommunity.com/sharedfiles/filedetails/?id=${req.params.workshopId}`);
        const html = await response.text();
        const match = html.match(/<link rel="image_src" href="([^"]+)">/);
        if (match && match[1]) {
            res.redirect(match[1].replace(/&amp;/g, '&'));
        } else {
            res.redirect('/img/default_steam.png'); // fallback
        }
    } catch (e) {
        res.redirect('/img/default_steam.png');
    }
});

// Instalar plugin de Rust
router.post('/:serverId/rust/install', requireAuth, async (req, res) => {
    try {
        const { serverId } = req.params;
        const { pluginUrl, pluginName } = req.body;
        let parsedUrl;
        try { parsedUrl = new URL(pluginUrl); } catch { return res.status(400).json({ error: 'URL de plugin inválida.' }); }
        if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'umod.org' || !/^[A-Za-z0-9_-]{1,80}$/.test(String(pluginName))) {
            return res.status(400).json({ error: 'Solo se permiten plugins HTTPS de uMod con nombre seguro.' });
        }
        const result = await modService.installRustPlugin(serverId, req.user.sub, req.user.role === 'admin', parsedUrl.href, pluginName);
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
        if (!/^\d{1,20}$/.test(String(modId))) return res.status(400).json({ error: 'ID de mod inválido.' });
        const result = await modService.installArkMod(serverId, req.user.sub, req.user.role === 'admin', modId);
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

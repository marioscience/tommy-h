import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getServerByIdForUser } from '../services/serverService.js';
import { controlServer } from '../services/serverControlService.js';
import { runRemoteCommand } from '../services/dockerService.js';
import { logAudit } from '../db.js';

const router = express.Router();

router.use(requireAuth);

// Buscar Plugins
router.get('/search', async (req, res) => {
    try {
        const { game, q } = req.query;
        if (!game || !q) return res.status(400).json({ error: 'Falta game o q' });

        let results = [];

        if (game === 'rust') {
            // uMod API for Rust
            const response = await fetch(`https://umod.org/plugins/search.json?query=${encodeURIComponent(q)}`);
            if (!response.ok) throw new Error('Error conectando a uMod');
            const data = await response.json();
            
            // Format to generic schema
            results = data.map(p => ({
                id: p.name,
                name: p.title,
                author: p.author,
                description: p.description,
                downloads: p.downloads || 0,
                iconUrl: p.icon_url || 'https://umod.org/images/icon.png',
                game: 'rust'
            }));
        } else if (game === 'minecraft') {
            // Spiget API for Minecraft
            const response = await fetch(`https://api.spiget.org/v2/search/resources/${encodeURIComponent(q)}?field=name&sort=-downloads&size=20`);
            if (!response.ok) throw new Error('Error conectando a Spiget');
            const data = await response.json();
            
            // Format to generic schema
            results = data.map(p => ({
                id: p.id.toString(),
                name: p.name,
                author: 'SpigotMC', // Spiget doesnt easily return author name without extra call
                description: p.tag || 'Minecraft Plugin',
                downloads: p.downloads || 0,
                iconUrl: p.icon?.url ? `https://www.spigotmc.org/${p.icon.url}` : 'https://static.wikia.nocookie.net/minecraft_gamepedia/images/4/44/Grass_Block_Revision_6.png',
                game: 'minecraft'
            }));
        } else {
            return res.status(400).json({ error: 'Juego no soportado para plugins.' });
        }

        res.json({ items: results });
    } catch (e) {
        console.error('[GET /plugins/search]', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Instalar Plugin
router.post('/install/:serverId', async (req, res) => {
    try {
        const { pluginId, game } = req.body;
        if (!pluginId || !game) return res.status(400).json({ error: 'Faltan campos (pluginId, game)' });

        const s = await getServerByIdForUser(req.params.serverId, req.user.sub, req.user.role === 'admin', 'files');
        if (!s) return res.status(404).json({ error: 'Servidor no encontrado' });

        let cmd = '';

        if (game === 'rust') {
            if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(pluginId))) return res.status(400).json({ error: 'Plugin inválido.' });
            const pluginUrl = `https://umod.org/plugins/${pluginId}.cs`;
            // Rust plugins go into oxide/plugins/
            cmd = `docker exec -w /home/container/oxide/plugins ${s.container_name} bash -c "curl -sL -A 'Mozilla/5.0' -o ${pluginId}.cs ${pluginUrl}"`;
        } else if (game === 'minecraft') {
            if (!/^\d{1,20}$/.test(String(pluginId))) return res.status(400).json({ error: 'Plugin inválido.' });
            const pluginUrl = `https://api.spiget.org/v2/resources/${pluginId}/download`;
            // Minecraft plugins go into plugins/
            cmd = `docker exec -w /home/container/plugins ${s.container_name} bash -c "curl -sL -A 'Mozilla/5.0' -o plugin_${pluginId}.jar ${pluginUrl}"`;
        } else {
            return res.status(400).json({ error: 'Juego no soportado' });
        }

        await runRemoteCommand(s.node_id, cmd);
        await logAudit(req, 'server.plugin.install', { serverId: req.params.serverId, pluginId, game });

        // Intentar recargar si está encendido y es Rust
        if (game === 'rust' && s.status === 'running') {
            const { sendCommandToContainer } = await import('../services/dockerService.js');
            await sendCommandToContainer(s.container_name, `oxide.reload ${pluginId}`);
        }

        res.json({ ok: true, message: 'Plugin instalado correctamente.' });
    } catch (e) {
        console.error('[POST /plugins/install]', e.message);
        res.status(500).json({ error: e.message });
    }
});

export default router;

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getServerByIdForUser } from '../services/serverService.js';
import { executeRconCommand, getLivePlayers, getLiveChat, getRustKillFeed, getPalworldGuilds, getValheimLists, updateValheimList } from '../services/rconService.js';
import { query, logAudit } from '../db.js';
import { deriveServicePassword } from '../services/dockerUtils.js';

const router = express.Router();
router.use(requireAuth);

/**
 * Middleware para verificar acceso y permisos de RCON/Consola.
 */
async function checkRconPermission(req, res, next) {
    try {
        const s = await getServerByIdForUser(req.params.id, req.user.sub, req.user.role === 'admin');
        if (!s) return res.status(404).json({ error: 'Servidor no encontrado.' });

        if (s.owner_id !== req.user.sub && req.user.role !== 'admin') {
            const suRes = await query("SELECT permissions FROM server_subusers WHERE server_id = $1 AND user_id = $2", [req.params.id, req.user.sub]);
            if (suRes.rowCount === 0) return res.status(403).json({ error: "Acceso denegado al servidor." });
            const perms = suRes.rows[0].permissions || [];
            
            const requiredPerm = req.method === 'GET' ? 'console' : 'rcon';
            if (!perms.includes(requiredPerm) && !perms.includes('rcon')) {
                return res.status(403).json({ error: `No tienes permiso de '${requiredPerm}' para esta acción.` });
            }
        }

        req.server = s;
        next();
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

router.use('/:id', checkRconPermission);

function getRconConfig(s) {
    let rconPort = s.fivem_port + 13;
    let rconPass = deriveServicePassword('generic-rcon', s.id);
    let kickCmd = 'kickplayer';
    let banCmd = 'banplayer';
    let wlCmd = 'allowplayertojoinnocheck';

    switch (s.template) {
        case 'minecraft':
            rconPort = 0;
            kickCmd = 'kick';
            banCmd = 'ban';
            wlCmd = 'whitelist add';
            break;
        case 'rust':
            rconPort = s.fivem_port + 1;
            kickCmd = 'kick';
            banCmd = 'ban';
            wlCmd = 'mute';
            break;
        case 'palworld':
            rconPort = s.fivem_port + 1;
            rconPass = deriveServicePassword('palworld-admin', s.id);
            kickCmd = 'KickPlayer';
            banCmd = 'BanPlayer';
            wlCmd = 'Broadcast';
            break;
        case 'cs2':
            rconPort = s.fivem_port;
            rconPass = deriveServicePassword('cs2-rcon', s.id);
            kickCmd = 'kickid';
            banCmd = 'banid';
            wlCmd = 'status';
            break;
        case 'zomboid':
            rconPort = s.fivem_port + 1;
            rconPass = deriveServicePassword('zomboid-admin', s.id);
            kickCmd = 'kickuser';
            banCmd = 'banuser';
            wlCmd = 'addalltowhitelist';
            break;
        case 'valheim':
            rconPort = s.fivem_port + 2;
            kickCmd = 'kick';
            banCmd = 'ban';
            wlCmd = 'unban';
            break;
        case 'sdtd':
            rconPort = s.fivem_port + 2;
            rconPass = deriveServicePassword('sdtd-telnet', s.id);
            kickCmd = 'kick';
            banCmd = 'ban';
            wlCmd = 'admin add';
            break;
        case 'ark':
            rconPort = s.fivem_port + 13;
            rconPass = deriveServicePassword('ark-admin', s.id);
            kickCmd = 'KickPlayer';
            banCmd = 'BanPlayer';
            wlCmd = 'allowplayertojoinnocheck';
            break;
    }
    return { rconPort, rconPass, kickCmd, banCmd, wlCmd };
}

// 1. Ejecutar comando RCON arbitrario o Broadcast
router.post('/:id/command', async (req, res) => {
    try {
        const { command } = req.body;
        if (!command || typeof command !== 'string') return res.status(400).json({ error: 'Comando inválido.' });

        const s = req.server;
        const { rconPort, rconPass } = getRconConfig(s);

        const output = await executeRconCommand('172.17.0.1', rconPort, rconPass, command, s.container_name, s.template);
        await logAudit(req, 'server.rcon.command', { serverId: s.id, command });

        res.json({ success: true, output });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2. Obtener lista de jugadores en vivo
router.get('/:id/players', async (req, res) => {
    try {
        const s = req.server;
        const { rconPort, rconPass } = getRconConfig(s);

        const players = await getLivePlayers('172.17.0.1', rconPort, rconPass, s.container_name, s.template);
        res.json({ players });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 3. Expulsar jugador (Kick)
router.post('/:id/players/kick', async (req, res) => {
    try {
        const { steamId } = req.body;
        if (!steamId) return res.status(400).json({ error: 'Falta el SteamID.' });

        const s = req.server;
        const { rconPort, rconPass, kickCmd } = getRconConfig(s);

        const output = await executeRconCommand('172.17.0.1', rconPort, rconPass, `${kickCmd} ${steamId}`, s.container_name, s.template);
        await logAudit(req, 'server.rcon.kick', { serverId: s.id, steamId });

        res.json({ success: true, output });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 4. Banear jugador
router.post('/:id/players/ban', async (req, res) => {
    try {
        const { steamId } = req.body;
        if (!steamId) return res.status(400).json({ error: 'Falta el SteamID.' });

        const s = req.server;
        const { rconPort, rconPass, banCmd } = getRconConfig(s);

        const output = await executeRconCommand('172.17.0.1', rconPort, rconPass, `${banCmd} ${steamId}`, s.container_name, s.template);
        await logAudit(req, 'server.rcon.ban', { serverId: s.id, steamId });

        res.json({ success: true, output });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 5. Whitelistar / Acción rápida
router.post('/:id/players/whitelist', async (req, res) => {
    try {
        const { steamId } = req.body;
        if (!steamId) return res.status(400).json({ error: 'Falta el SteamID.' });

        const s = req.server;
        const { rconPort, rconPass, wlCmd } = getRconConfig(s);

        const output = await executeRconCommand('172.17.0.1', rconPort, rconPass, `${wlCmd} ${steamId}`, s.container_name, s.template);
        await logAudit(req, 'server.rcon.whitelist', { serverId: s.id, steamId });

        res.json({ success: true, output });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 6. Obtener chat en vivo
router.get('/:id/chat', async (req, res) => {
    try {
        const s = req.server;
        const { rconPort, rconPass } = getRconConfig(s);

        const chat = await getLiveChat('172.17.0.1', rconPort, rconPass, s.container_name, s.template);
        res.json({ chat });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// 🚀 ENDPOINTS PREMIUM EXTENDIDOS POR JUEGO
// ==========================================

// ☢️ Rust: Kill Feed
router.get('/:id/killfeed', async (req, res) => {
    try { res.json({ feed: await getRustKillFeed(req.server.container_name) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// 🥚 Palworld: Gremios
router.get('/:id/guilds', async (req, res) => {
    try { res.json({ guilds: await getPalworldGuilds(req.server.container_name) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// 🪓 Valheim: Listas de acceso
router.get('/:id/valheim-lists', async (req, res) => {
    try { res.json(await getValheimLists(req.server.container_name)); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/valheim-lists/update', async (req, res) => {
    try { res.json(await updateValheimList(req.server.container_name, req.body.listType, req.body.action, req.body.steamId)); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// 🔫 CS2: Matchpad
router.post('/:id/matchpad', async (req, res) => {
    try {
        const { command } = req.body;
        const s = req.server;
        const { rconPort, rconPass } = getRconConfig(s);
        const output = await executeRconCommand('172.17.0.1', rconPort, rconPass, command, s.container_name, s.template);
        res.json({ success: true, output });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;

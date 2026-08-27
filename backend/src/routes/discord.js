import express from 'express';
import Docker from 'dockerode';
import { config } from '../config.js';
import { query } from '../db.js';
import * as serverService from '../services/serverService.js';
import crypto from 'crypto';

const router = express.Router();

// 🐳 Conexión al motor del sistema de servidores
const motorServidores = new Docker({ socketPath: config.dockerSocket });

// 🛡️ MIDDLEWARE DE SEGURIDAD ESTRICTA
const verifyApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    const received = crypto.createHash('sha256').update(String(apiKey || '')).digest();
    const expected = crypto.createHash('sha256').update(String(config.discordApiKey || '')).digest();
    if (!apiKey || !crypto.timingSafeEqual(received, expected)) {
        console.warn(`⚠️ Intento de acceso bloqueado a la API del bot desde IP: ${req.ip}`);
        return res.status(401).json({ error: 'Acceso denegado. API Key inválida.' });
    }
    next();
};

// ============================================================================
// 📡 RUTA 1: STATUS PING (Para el comando !status)
// ============================================================================
router.get('/ping', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'RageNodes Bot API Online' });
});

// ============================================================================
// 🚀 RUTA 2: EXTRACCIÓN TOTAL (!ip, !miperfil, !diagnostico)
// ============================================================================
router.get('/diagnostico/:discordId', verifyApiKey, async (req, res) => {
    const { discordId } = req.params;

    try {
        // 1️⃣ BUSCAR USUARIO EN POSTGRESQL
        const userQuery = await query(
            'SELECT id, username, plan FROM users WHERE discord_id = $1 LIMIT 1',
            [discordId]
        );

        if (userQuery.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado o no vinculado.' });
        }

        const user = userQuery.rows[0];

        // 2️⃣ BUSCAR LOS SERVIDORES DEL USUARIO (Corregido owner_id y container_name)
        const serversQuery = await query(
            'SELECT id, name, container_name, fivem_port, status FROM servers WHERE owner_id = $1',
            [user.id]
        );

        const userServers = [];

        // 3️⃣ MAGIA PURA: Extraer telemetría del sistema en tiempo real
        for (const srv of serversQuery.rows) {
            let cpuPercent = 0;
            let ramPercent = 0;
            let diskPercent = 0; // El disco es complejo de medir en vivo, lo dejamos en 0 de forma segura
            let currentStatus = srv.status;

            try {
                if (srv.container_name) {
                    const servidorInstancia = motorServidores.getContainer(srv.container_name);
                    const inspect = await servidorInstancia.inspect();

                    currentStatus = inspect.State.Running ? 'running' : 'stopped';

                    // Solo calcular si el servidor está encendido
                    if (currentStatus === 'running') {
                        const stats = await servidorInstancia.stats({ stream: false });

                        // Cálculo exacto de CPU (Fórmula del sistema)
                        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
                        const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
                        if (systemDelta > 0 && cpuDelta > 0) {
                            cpuPercent = (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100;
                        }

                        // Cálculo exacto de Memoria RAM
                        const usedMemory = stats.memory_stats.usage - (stats.memory_stats.stats?.cache || 0);
                        const totalMemory = stats.memory_stats.limit;
                        ramPercent = (usedMemory / totalMemory) * 100;
                    }
                }
            } catch (sysErr) {
                console.warn(`⚠️ No se pudo leer la telemetría del sistema para el servidor ${srv.name}`);
                // Si el sistema falla para un servidor, no tiramos la API. Simplemente devuelve 0%.
            }

            // Añadir el servidor procesado a la lista
            userServers.push({
                id: srv.id,
                name: srv.name,
                status: currentStatus,
                ip: config.fivemPublicHost,     // Lee node1.ragenodes.com de tu config
                fivem_port: srv.fivem_port,     // El puerto real sacado de Postgres
                cpu_percent: parseFloat(cpuPercent.toFixed(1)),
                ram_percent: parseFloat(ramPercent.toFixed(1)),
                disk_percent: diskPercent
            });
        }

        // 4️⃣ RESPONDER AL BOT EN EL FORMATO PERFECTO
        res.json({
            username: user.username,
            plan: user.plan || "Hobby",
            servers: userServers
        });

    } catch (error) {
        console.error(`❌ Error fatal consultando datos para Discord ID ${discordId}:`, error);
        res.status(500).json({ error: 'Error interno conectando a la base de datos.' });
    }
});

// ============================================================================
// 🤖 RUTA 3: SISTEMA DE APRENDIZAJE — Crear patrón nuevo
// ============================================================================
router.post('/aprender', verifyApiKey, async (req, res) => {
    const { patron, respuesta, contexto, creado_por } = req.body;
    if (!patron || !respuesta) {
        return res.status(400).json({ error: 'Se requiere patron y respuesta.' });
    }
    try {
        const result = await query(
            `INSERT INTO bot_knowledge (patron, respuesta, contexto, creado_por, activo)
             VALUES ($1, $2, $3, $4, true) RETURNING id, patron, respuesta, contexto, creado_por, created_at`,
            [patron.toLowerCase().trim(), respuesta, contexto || 'general', creado_por || 'admin']
        );
        console.log(`🤖 Nuevo patrón aprendido por ${creado_por}: "${patron}"`);
        res.json({ ok: true, knowledge: result.rows[0] });
    } catch (error) {
        console.error('❌ Error guardando patrón de conocimiento:', error);
        res.status(500).json({ error: 'Error interno al guardar el patrón.' });
    }
});

// ============================================================================
// 🤖 RUTA 4: SISTEMA DE APRENDIZAJE — Listar todo el conocimiento
// ============================================================================
router.get('/conocimiento', verifyApiKey, async (req, res) => {
    try {
        const result = await query(
            `SELECT id, patron, respuesta, contexto, peso, veces_usado, creado_por, activo, created_at
             FROM bot_knowledge WHERE activo = true ORDER BY peso DESC, veces_usado DESC`
        );
        res.json({ ok: true, total: result.rowCount, knowledge: result.rows });
    } catch (error) {
        console.error('❌ Error listando conocimiento:', error);
        res.status(500).json({ error: 'Error interno al listar el conocimiento.' });
    }
});

// ============================================================================
// 🤖 RUTA 5: SISTEMA DE APRENDIZAJE — Eliminar/desactivar patrón
// ============================================================================
router.delete('/conocimiento/:id', verifyApiKey, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await query(
            `UPDATE bot_knowledge SET activo = false, updated_at = NOW() WHERE id = $1 RETURNING id, patron`,
            [id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Patrón no encontrado.' });
        }
        console.log(`🗑️ Patrón eliminado ID ${id}: "${result.rows[0].patron}"`);
        res.json({ ok: true, deleted: result.rows[0] });
    } catch (error) {
        console.error('❌ Error eliminando patrón:', error);
        res.status(500).json({ error: 'Error interno al eliminar el patrón.' });
    }
});

// ============================================================================
// 🤖 RUTA 6: SISTEMA DE APRENDIZAJE — Registrar uso de patrón (refuerzo)
// ============================================================================
router.post('/conocimiento/:id/uso', verifyApiKey, async (req, res) => {
    const { id } = req.params;
    try {
        await query(
            `UPDATE bot_knowledge 
             SET veces_usado = veces_usado + 1, 
                 peso = LEAST(peso + 0.05, 10.0),
                 updated_at = NOW()
             WHERE id = $1`,
            [id]
        );
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: 'Error al registrar uso.' });
    }
});

// ============================================================================
// 🤖 RUTA 7: LOGS DE TICKETS — Guardar conversación completa
// ============================================================================
router.post('/ticket-log', verifyApiKey, async (req, res) => {
    const { discord_user_id, discord_username, canal_id, mensajes, intenciones_detectadas, resuelto_por_ia, escalado_a_humano, patron_usado_id } = req.body;
    if (!discord_user_id || !canal_id) {
        return res.status(400).json({ error: 'Se requiere discord_user_id y canal_id.' });
    }
    try {
        const result = await query(
            `INSERT INTO bot_ticket_logs (discord_user_id, discord_username, canal_id, mensajes, intenciones_detectadas, resuelto_por_ia, escalado_a_humano, patron_usado_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [
                discord_user_id, discord_username || 'unknown', canal_id,
                JSON.stringify(mensajes || []),
                intenciones_detectadas || [],
                resuelto_por_ia || false,
                escalado_a_humano || false,
                patron_usado_id || null
            ]
        );
        res.json({ ok: true, log_id: result.rows[0].id });
    } catch (error) {
        console.error('❌ Error guardando log de ticket:', error);
        res.status(500).json({ error: 'Error interno al guardar el log.' });
    }
});

// ============================================================================
// 🤖 RUTA 8: REGISTRAR ESTADÍSTICA + RUTA 9: VER ESTADÍSTICAS
// ============================================================================
router.post('/estadistica', verifyApiKey, async (req, res) => {
    const { intencion, resuelto, escalado, patron_id } = req.body;
    try {
        await query(
            `INSERT INTO bot_stats (intencion, resuelto, escalado, patron_id) VALUES ($1, $2, $3, $4)`,
            [intencion || 'desconocida', resuelto || false, escalado || false, patron_id || null]
        );
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: 'Error al guardar estadística.' });
    }
});

router.get('/estadisticas', verifyApiKey, async (req, res) => {
    try {
        const [resumen, top_intenciones, top_patrones] = await Promise.all([
            query(`
                SELECT 
                    COUNT(*) as total_interacciones,
                    SUM(CASE WHEN resuelto THEN 1 ELSE 0 END) as resueltas_por_ia,
                    SUM(CASE WHEN escalado THEN 1 ELSE 0 END) as escaladas_a_humano
                FROM bot_stats
            `),
            query(`
                SELECT intencion, COUNT(*) as veces
                FROM bot_stats GROUP BY intencion ORDER BY veces DESC LIMIT 10
            `),
            query(`
                SELECT id, patron, veces_usado, peso
                FROM bot_knowledge WHERE activo = true
                ORDER BY veces_usado DESC LIMIT 5
            `)
        ]);
        res.json({
            ok: true,
            resumen: resumen.rows[0],
            top_intenciones: top_intenciones.rows,
            top_patrones: top_patrones.rows
        });
    } catch (error) {
        console.error('❌ Error en estadísticas:', error);
        res.status(500).json({ error: 'Error interno al obtener estadísticas.' });
    }
});

// ============================================================================
// 🎮 RUTA 10: CONTROL DE SERVIDORES (Iniciar, Parar, Reiniciar)
// ============================================================================
router.post('/control/:serverId/:action', verifyApiKey, async (req, res) => {
    const { serverId, action } = req.params;
    try {
        // En la API de Discord asumimos privilegios de Admin para el bot
        const result = await serverService.controlServer(serverId, 'DISCORD_BOT', action, true);
        res.json(result);
    } catch (error) {
        console.error(`❌ Error controlando server ${serverId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// 🛠️ RUTA 11: REPARACIÓN AUTOMÁTICA
// ============================================================================
router.post('/repair/:serverId', verifyApiKey, async (req, res) => {
    const { serverId } = req.params;
    try {
        const result = await serverService.repairServer(serverId, 'DISCORD_BOT', true);
        res.json(result);
    } catch (error) {
        console.error(`❌ Error reparando server ${serverId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// 🛒 RUTA 12: APROBACIÓN DE VENDEDORES (MARKETPLACE)
// ============================================================================
router.post('/vendor-action/:applicationId', verifyApiKey, async (req, res) => {
    const { applicationId } = req.params;
    const { action } = req.body; // 'accepted', 'saved', 'rejected'
    
    if (!['accepted', 'saved', 'rejected', 'revoke'].includes(action)) {
        return res.status(400).json({ error: 'Acción no válida' });
    }

    try {
        const appQuery = await query('SELECT user_id FROM vendor_applications WHERE id = $1', [applicationId]);
        if (appQuery.rowCount === 0) {
            return res.status(404).json({ error: 'Postulación no encontrada' });
        }

        const userId = appQuery.rows[0].user_id;
        const newStatus = action === 'saved' ? 'pending' : (action === 'revoke' ? 'revoked' : action);

        // Actualizar el estado de la postulación
        await query('UPDATE vendor_applications SET status = $1, updated_at = NOW() WHERE id = $2', [newStatus, applicationId]);

        // Si es aceptado, darle el rol de vendor
        if (action === 'accepted') {
            await query('UPDATE users SET role = $1 WHERE id = $2 AND role = $3', ['vendor', userId, 'user']);
        } else if (action === 'revoke') {
            // Si es revocado, quitarle el rol de vendor
            await query('UPDATE users SET role = $1 WHERE id = $2 AND role = $3', ['user', userId, 'vendor']);
        }

        res.json({ ok: true, message: `Postulación ${action} correctamente.` });
    } catch (error) {
        console.error(`❌ Error procesando acción de vendedor para app ${applicationId}:`, error);
        res.status(500).json({ error: 'Error interno procesando acción.' });
    }
});

router.get('/vendors', verifyApiKey, async (req, res) => {
    try {
        const result = await query(`
            SELECT id, user_id, discord_username, portfolio_url, status, created_at
            FROM vendor_applications
            ORDER BY created_at DESC
            LIMIT 50
        `);
        res.json({ ok: true, vendors: result.rows });
    } catch (error) {
        console.error('❌ Error listando vendedores:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// ============================================================================
// 🐳 RUTA 13: LISTAR CONTENEDORES ACTIVOS DE CLIENTES (Para OxideProxy L7)
// ============================================================================
router.get('/servers', verifyApiKey, async (req, res) => {
    try {
        const result = await query("SELECT container_name FROM servers WHERE status NOT IN ('stopped', 'suspended', 'offline')");
        res.json({ ok: true, servers: result.rows.map(r => r.container_name).filter(Boolean) });
    } catch (error) {
        console.error('❌ Error listando servidores para OxideProxy:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// Inventario L4 autorizado para OxideProxy. El panel de Oxide nunca recibe el
// socket Docker: el backend valida que el contenedor exista y esté ejecutándose.
router.get('/servers/routes', verifyApiKey, async (req, res) => {
    try {
        const result = await query(`
            SELECT id, name, template, fivem_port, container_name, node_id
            FROM servers
            ORDER BY fivem_port ASC
        `);
        const protocolOffsets = {
            minecraft: [[0, 'TCP']],
            fivem: [[0, 'DUAL']],
            rust: [[0, 'UDP'], [1, 'TCP'], [2, 'UDP']],
            palworld: [[0, 'UDP'], [1, 'TCP'], [2, 'UDP']],
            cs2: [[0, 'DUAL']],
            valheim: [[0, 'UDP'], [1, 'UDP'], [2, 'UDP']],
            zomboid: [[0, 'UDP'], [1, 'UDP']],
            ark: Array.from({ length: 14 }, (_, offset) => [offset, 'DUAL']),
            sdtd: [[0, 'DUAL'], [1, 'UDP'], [2, 'UDP'], [3, 'UDP']]
        };
        const routes = [];

        for (const server of result.rows) {
            if (!server.container_name || !Number.isInteger(Number(server.fivem_port))) continue;
            // El inventario actual solo anuncia el daemon local. Los nodos
            // remotos se publicarán por su propio backend/edge autorizado.
            if (Number(server.node_id || 0) !== 0) continue;
            let inspect;
            try {
                inspect = await motorServidores.getContainer(server.container_name).inspect();
                // Docker es la fuente de verdad para el plano de datos. El
                // estado SQL puede retrasarse tras un reinicio o recuperación,
                // pero nunca se anuncia un contenedor inexistente o detenido.
                if (!inspect?.State?.Running) continue;
            } catch {
                continue;
            }

            if (config.oxideGameProxyEnabled && inspect?.Config?.Labels?.['ragenodes.game_proxy'] !== 'enabled') {
                // Un contenedor todavía publicado en el puerto público no debe
                // anunciarse: Oxide no podría vincular ese mismo puerto.
                continue;
            }

            const basePort = Number(server.fivem_port);
            const offsets = protocolOffsets[server.template] || [[0, 'DUAL']];
            const labelOffset = Number(inspect?.Config?.Labels?.['ragenodes.game_proxy_offset']);
            const backendOffset = config.oxideGameProxyEnabled
                ? (Number.isInteger(labelOffset) && labelOffset > 0 ? labelOffset : config.gameBackendPortOffset)
                : 0;
            const published = new Set();
            for (const [containerPort, bindings] of Object.entries(inspect?.HostConfig?.PortBindings || {})) {
                const transport = String(containerPort).split('/')[1]?.toUpperCase();
                for (const binding of bindings || []) {
                    published.add(`${Number(binding.HostPort)}:${transport}`);
                }
            }
            for (const [offset, protocol] of offsets) {
                const port = basePort + offset;
                const backendPort = port + backendOffset;
                const requiredProtocols = protocol === 'DUAL' ? ['TCP', 'UDP'] : [protocol];
                if (!requiredProtocols.every(item => published.has(`${backendPort}:${item}`))) continue;
                routes.push({
                    game_id: port,
                    name: `auto:${server.container_name}:${port}`,
                    backend_addr: `127.0.0.1:${backendPort}`,
                    protocol,
                    port_range: String(port),
                    description: `Auto ${String(server.template).toUpperCase()} - ${server.name}`
                });
            }
        }

        res.json({ ok: true, generated_at: new Date().toISOString(), routes });
    } catch (error) {
        console.error('❌ Error generando rutas para OxideProxy:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// Recarga acotada del plano de datos. No acepta nombres proporcionados por el
// cliente: solo reinicia el servicio Compose configurado para Oxide Game.
router.post('/servers/routes/reload-proxy', verifyApiKey, async (req, res) => {
    try {
        const service = String(config.oxideGameProxyService || 'oxide_game');
        if (!/^oxide_game(?:_staging)?$/.test(service)) {
            return res.status(503).json({ error: 'Servicio de proxy no autorizado' });
        }
        const containers = await motorServidores.listContainers({
            all: true,
            filters: { label: [`com.docker.compose.service=${service}`] }
        });
        if (containers.length !== 1) {
            return res.status(503).json({ error: 'Proxy de juego no disponible de forma inequívoca' });
        }
        await motorServidores.getContainer(containers[0].Id).restart({ t: 10 });
        res.json({ ok: true, service });
    } catch (error) {
        console.error('❌ Error recargando Oxide Game:', error);
        res.status(500).json({ error: 'No se pudo recargar el proxy de juego' });
    }
});

// ============================================================================
// 🛡️ RUTA 14: OBTENER PROXY ACTIVO (Para OxideProxy Sync)
// ============================================================================
router.get('/proxies/active', verifyApiKey, async (req, res) => {
    try {
        const result = await query("SELECT ip_address, api_port, api_key FROM edge_proxies WHERE is_active = true LIMIT 1");
        if (result.rowCount === 0) {
            return res.json({ ok: false, error: 'No active proxy found' });
        }
        res.json({ ok: true, proxy: result.rows[0] });
    } catch (error) {
        console.error('❌ Error obteniendo proxy activo:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

export default router;

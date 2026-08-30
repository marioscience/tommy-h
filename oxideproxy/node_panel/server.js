const express = require('express');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const axios = require('axios');
const os = require('os');
const net = require('net');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_PATH = process.env.CONFIG_PATH || (fs.existsSync('/app/rust_config/oxide_proxy.yml') ? '/app/rust_config/oxide_proxy.yml' : path.join(__dirname, '../config/oxide_proxy.yml'));
const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://oxide_prometheus:9090';
const BACKEND_URL = (process.env.BACKEND_URL || 'http://backend:3006').replace(/\/$/, '');
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';
const METRICS_PATH = process.env.OXIDE_METRICS_PATH || '/app/runtime/game_metrics.json';
const LOG_DIR = process.env.OXIDE_LOG_DIR || '/app/runtime/logs';
const DEFAULT_WEB_BACKEND = process.env.OXIDE_DEFAULT_WEB_BACKEND || '';
const PDNS_API_URL = String(process.env.PDNS_API_URL || '').replace(/\/$/, '');
const PDNS_API_KEY = process.env.PDNS_API_KEY || '';
const PDNS_SERVER_ID = process.env.PDNS_SERVER_ID || 'localhost';
const PDNS_MANAGED_ZONES = String(process.env.PDNS_MANAGED_ZONES || process.env.POWERDNS_ZONE || '')
    .split(',').map(value => value.trim().replace(/\.$/, '').toLowerCase()).filter(Boolean);
const METRICS_WINDOW_MS = Math.max(5000, Number(process.env.OXIDE_METRICS_WINDOW_MS || 15000));
const metricsSamples = [];

function normalizedManagedZone(value) {
    const zone = String(value || '').trim().replace(/\.$/, '').toLowerCase();
    return PDNS_MANAGED_ZONES.includes(zone) ? zone : '';
}

function validRecordName(name, zone) {
    const normalized = String(name || '').trim().replace(/\.$/, '').toLowerCase();
    if (!normalized || normalized.length > 253) return '';
    if (normalized !== zone && !normalized.endsWith(`.${zone}`)) return '';
    const labels = normalized.split('.');
    if (labels.some((label, index) => {
        if (label === '*') return index !== 0;
        if (!label || label.length > 63 || !/^[a-z0-9_-]+$/.test(label)) return true;
        return label.startsWith('-') || label.endsWith('-');
    })) return '';
    return normalized;
}

function validHostname(value) {
    const normalized = String(value || '').trim().replace(/\.$/, '').toLowerCase();
    if (!normalized || normalized.length > 253) return false;
    return normalized.split('.').every(label => label.length > 0 && label.length <= 63
        && /^[a-z0-9_-]+$/.test(label) && !label.startsWith('-') && !label.endsWith('-'));
}

function validRecordContent(type, value) {
    const content = String(value || '').trim();
    if (!content || content.length > 1024 || /[\r\n\0]/.test(content)) return false;
    if (type === 'A') return net.isIP(content) === 4;
    if (type === 'AAAA') return net.isIP(content) === 6;
    if (type === 'CNAME') return validHostname(content);
    if (type === 'TXT') return /^"(?:[^"\\]|\\.)*"$/.test(content);
    if (type === 'MX') return /^(?:0|[1-9]\d{0,4})\s+\S+$/.test(content)
        && validHostname(content.replace(/^\d+\s+/, ''));
    if (type === 'SRV') {
        const match = content.match(/^(\d{1,5})\s+(\d{1,5})\s+(\d{1,5})\s+(\S+)$/);
        return Boolean(match && match.slice(1, 4).every(valuePart => Number(valuePart) <= 65535)
            && validHostname(match[4]));
    }
    if (type === 'CAA') return /^(?:0|[1-9]\d{0,2})\s+(?:issue|issuewild|iodef)\s+"[^"\r\n]+"$/.test(content);
    return false;
}

function powerDnsClient() {
    if (!PDNS_API_URL || !PDNS_API_KEY || PDNS_MANAGED_ZONES.length === 0) return null;
    return axios.create({
        baseURL: `${PDNS_API_URL}/servers/${encodeURIComponent(PDNS_SERVER_ID)}`,
        headers: { 'X-API-Key': PDNS_API_KEY },
        timeout: 5000,
        validateStatus: () => true
    });
}

function readNativeMetricsSnapshot() {
    try {
        const snapshot = JSON.parse(fs.readFileSync(METRICS_PATH, 'utf8'));
        return Number.isFinite(Number(snapshot?.timestamp_ms)) ? snapshot : null;
    } catch {
        return null;
    }
}

function sampleNativeMetrics() {
    const snapshot = readNativeMetricsSnapshot();
    if (!snapshot) return;
    const timestamp = Number(snapshot.timestamp_ms);
    const last = metricsSamples[metricsSamples.length - 1];
    if (!last || Number(last.timestamp_ms) !== timestamp) metricsSamples.push(snapshot);
    const cutoff = timestamp - METRICS_WINDOW_MS;
    while (metricsSamples.length > 2 && Number(metricsSamples[1].timestamp_ms) < cutoff) {
        metricsSamples.shift();
    }
}

function nativeMetricsWindow() {
    sampleNativeMetrics();
    const current = metricsSamples[metricsSamples.length - 1] || null;
    const cutoff = Number(current?.timestamp_ms || 0) - METRICS_WINDOW_MS;
    const previous = metricsSamples.find(sample => Number(sample.timestamp_ms) >= cutoff)
        || metricsSamples[0]
        || null;
    const elapsedSeconds = current && previous
        ? Math.max(0.001, (Number(current.timestamp_ms) - Number(previous.timestamp_ms)) / 1000)
        : 0;
    const rate = (field) => elapsedSeconds > 0
        ? Math.max(0, (Number(current?.[field] || 0) - Number(previous?.[field] || 0)) / elapsedSeconds)
        : 0;
    return { current, rate };
}

sampleNativeMetrics();
const nativeMetricsTimer = setInterval(sampleNativeMetrics, 1000);
nativeMetricsTimer.unref();

// El panel se mantiene deliberadamente separado del daemon de contenedores.
let discoveredBackends = [];
let consecutiveEmptyRouteSnapshots = 0;
const EMPTY_ROUTE_CONFIRMATIONS = Math.max(2, Number(process.env.OXIDE_EMPTY_ROUTE_CONFIRMATIONS || 3));

async function syncDockerGameServers() {
    try {
        const apiKey = process.env.OXIDE_ROUTE_API_KEY;
        if (!apiKey) throw new Error('OXIDE_ROUTE_API_KEY no configurada');
        const response = await axios.get(`${BACKEND_URL}/api/discord/servers/routes`, {
            headers: { 'x-api-key': apiKey },
            timeout: 5000
        });
        const managedRoutes = Array.isArray(response.data?.routes) ? response.data.routes : [];
        let configObj = {};
        if (fs.existsSync(CONFIG_PATH)) {
            configObj = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
        }
        configObj = migrateConfigToV2(configObj);
        if (DEFAULT_WEB_BACKEND) configObj.routing.default_web_backend = DEFAULT_WEB_BACKEND;
        const manualRoutes = (configObj.routing.game_servers || [])
            .filter(route => !String(route.name || '').startsWith('auto:'));
        const currentAutomaticRoutes = (configObj.routing.game_servers || [])
            .filter(route => String(route.name || '').startsWith('auto:'));

        // El inventario del backend puede quedar vacío durante una consulta
        // transitoria (reinicio, timeout interno o actualización de estado).
        // No retire rutas activas ni corte sesiones por una sola instantánea.
        if (managedRoutes.length === 0 && currentAutomaticRoutes.length > 0) {
            consecutiveEmptyRouteSnapshots += 1;
            if (consecutiveEmptyRouteSnapshots < EMPTY_ROUTE_CONFIRMATIONS) {
                console.warn(
                    `[OxideControlPanel] Inventario vacío transitorio ` +
                    `(${consecutiveEmptyRouteSnapshots}/${EMPTY_ROUTE_CONFIRMATIONS}); ` +
                    `se conservan ${currentAutomaticRoutes.length} rutas automáticas.`
                );
                return;
            }
        } else {
            consecutiveEmptyRouteSnapshots = 0;
        }
        const nextRoutes = manualRoutes.concat(managedRoutes.map(route => ({
            ...route,
            health_check: { enabled: false, interval_secs: 10, timeout_secs: 2 }
        })));
        discoveredBackends = managedRoutes.map(route => ({
            id: route.game_id,
            name: route.description || route.name,
            addr: route.backend_addr,
            protocol: route.protocol,
            health: 'HEALTHY (Backend verificado)'
        }));

        if (JSON.stringify(configObj.routing.game_servers || []) !== JSON.stringify(nextRoutes)) {
            configObj.routing.game_servers = nextRoutes;
            const temporaryPath = `${CONFIG_PATH}.tmp-${process.pid}`;
            // El fichero solo contiene rutas y ajustes no secretos; 0644
            // permite que el proceso Oxide (UID sin privilegios) lo lea.
            fs.writeFileSync(temporaryPath, yaml.dump(configObj), { encoding: 'utf8', mode: 0o644 });
            fs.renameSync(temporaryPath, CONFIG_PATH);
            fs.chmodSync(CONFIG_PATH, 0o644);
            console.log(`[OxideControlPanel] Tabla reconciliada: ${managedRoutes.length} rutas automáticas activas.`);
            console.log('[OxideControlPanel] El plano de datos detectará el cambio y se recargará de forma controlada.');
        }
    } catch(e) {
        // Fallo cerrado: se conserva la última tabla válida y nunca se recurre
        // al socket Docker ni a descubrimiento privilegiado.
        console.error('[OxideControlPanel] Error reconciliando rutas autorizadas:', e.message);
    }
}

// ==========================================================================
// LECTOR DE LOGS REALES (PRODUCCIÓN)
// ==========================================================================
function getLatestLogLines(maxLines = 300) {
    if (!fs.existsSync(LOG_DIR)) return [];

    try {
        const files = fs.readdirSync(LOG_DIR)
            .filter(f => f.startsWith('oxide_proxy.log'))
            .map(f => ({ name: f, time: fs.statSync(path.join(LOG_DIR, f)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time);

        if (files.length === 0) return [];

        const latestFile = path.join(LOG_DIR, files[0].name);
        const content = fs.readFileSync(latestFile, 'utf8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        
        const result = [];
        const start = Math.max(0, lines.length - maxLines);
        
        for (let i = start; i < lines.length; i++) {
            const line = lines[i];
            const match = line.match(/^(\d{4}-\d{2}-\d{2}T\S+)\s+(\w+)\s+([\w\:]+):\s+(.*)$/);
            if (match) {
                const ts = match[1];
                const lvl = match[2];
                const mod = match[3];
                const msg = match[4];

                let gameId = 'SYS';
                if (msg.includes('30120')) gameId = 30120;
                else if (msg.includes('25565')) gameId = 25565;
                else if (msg.includes('7777')) gameId = 7777;
                else if (msg.includes('27015')) gameId = 27015;
                else if (mod.includes('ebpf')) gameId = 'SYS';
                else {
                    const portMatch = msg.match(/:(\d{4,5})/);
                    if (portMatch) gameId = parseInt(portMatch[1], 10);
                }

                result.push({
                    timestamp: ts,
                    level: lvl,
                    game_id: gameId,
                    message: `[${mod}] ${msg}`
                });
            } else {
                result.push({
                    timestamp: new Date().toISOString(),
                    level: 'INFO',
                    game_id: 'SYS',
                    message: line
                });
            }
        }
        return result;
    } catch (e) {
        console.error('Error leyendo logs de producción:', e);
        return [];
    }
}

app.disable('x-powered-by');
app.use((req, res, next) => {
    res.set({
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors *; form-action 'self'; object-src 'none'; script-src 'self' 'unsafe-inline' https: http:; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline' https: http:; style-src-attr 'unsafe-inline'; img-src * 'self' data: blob: https: http:; connect-src 'self' ws: wss: https: http:; font-src 'self' https: http: data:; frame-src 'self' https: http:; manifest-src 'none'; media-src 'none'; worker-src 'none'",
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN'
    });
    next();
});
app.use(express.json({ limit: '256kb', strict: true, type: 'application/json' }));

// Middleware para manejo de errores
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

function requestOriginAllowed(req) {
    const origin = req.get('origin');
    if (!origin) return false;

    try {
        const parsedOrigin = new URL(origin);
        const allowedOrigins = new Set();
        if (PUBLIC_BASE_URL) allowedOrigins.add(new URL(PUBLIC_BASE_URL).origin);
        const host = req.get('host');
        if (host) {
            allowedOrigins.add(`http://${host}`);
            allowedOrigins.add(`https://${host}`);
        }
        return allowedOrigins.has(parsedOrigin.origin);
    } catch {
        return false;
    }
}

const tokenCache = new Map();

const requireAdmin = asyncHandler(async (req, res, next) => {
    const isJson = req.originalUrl.includes('/api/') || (req.headers.accept && req.headers.accept.includes('json'));
    const cookie = req.get('cookie');
    const authHeader = req.get('authorization');
    const tokenHeader = req.get('x-auth-token') || req.query.token;

    const cacheKey = tokenHeader || authHeader || cookie || '';
    if (cacheKey) {
        const cached = tokenCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            req.admin = cached.data;
            return next();
        }
    }

    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (authHeader) headers.authorization = authHeader;
    if (tokenHeader) {
        headers['x-auth-token'] = tokenHeader;
        if (!headers.authorization) {
            headers.authorization = `Bearer ${tokenHeader}`;
        }
    }

    let authResponse;
    try {
        authResponse = await axios.get(`${BACKEND_URL}/api/auth/me`, {
            headers,
            timeout: 3000,
            validateStatus: () => true
        });
    } catch {
        if (isJson) return res.status(503).json({ error: 'Servicio de autenticación no disponible.' });
        return res.status(503).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Servicio no disponible</title></head><body><h1>Servicio de autenticación no disponible.</h1></body></html>');
    }

    if (authResponse.status === 401) {
        if (isJson) return res.status(401).json({ error: 'Autenticación requerida.' });
        return res.status(401).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Autenticación requerida</title></head><body><h1>Autenticación requerida.</h1></body></html>');
    }

    if (authResponse.status !== 200) {
        const status = authResponse.status === 403 ? 403 : 503;
        if (isJson) return res.status(status).json({ error: 'No se pudo validar la sesión administrativa.' });
        return res.status(status).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sesión no validada</title></head><body><h1>No se pudo validar la sesión administrativa.</h1></body></html>');
    }

    if (authResponse.data?.role !== 'admin') {
        if (isJson) return res.status(403).json({ error: 'Acceso reservado a Administradores.' });
        return res.status(403).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Acceso denegado</title></head><body><h1>Acceso reservado a Administradores.</h1></body></html>');
    }

    if (cacheKey) {
        tokenCache.set(cacheKey, {
            data: authResponse.data,
            expiresAt: Date.now() + 30000
        });
    }

    req.admin = authResponse.data;
    next();
});

function requireSameOriginMutation(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('sec-fetch-site') && !['same-origin', 'same-site'].includes(req.get('sec-fetch-site'))) {
        return res.status(403).json({ error: 'Solicitud entre sitios rechazada.' });
    }
    if (!requestOriginAllowed(req)) {
        return res.status(403).json({ error: 'Origen de solicitud no permitido.' });
    }
    next();
}

app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
app.use('/api/oxide', requireAdmin, requireSameOriginMutation);
app.use(express.static(path.join(__dirname, 'public'), {
    index: false,
    extensions: ['html'],
    dotfiles: 'deny',
    fallthrough: true,
    maxAge: 0
}));
app.get(['/', '/index.html'], requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Función auxiliar para migrar/enriquecer la configuración YAML al nuevo esquema v2.0
function migrateConfigToV2(config) {
    if (!config) config = {};
    if (!config.ingress) config.ingress = {};
    if (!config.routing) config.routing = {};
    if (!config.tls) config.tls = {};
    if (!config.runtime) config.runtime = {};

    // Ingress defaults
    config.ingress.tcp_listen_addr = config.ingress.tcp_listen_addr || "0.0.0.0:8443";
    config.ingress.udp_listen_addr = config.ingress.udp_listen_addr || "0.0.0.0:8080";
    config.ingress.max_concurrent_connections = config.ingress.max_concurrent_connections || 1000000;
    config.ingress.initial_buffer_size = config.ingress.initial_buffer_size || 4096;
    config.ingress.max_buffer_size = config.ingress.max_buffer_size || 65536;
    config.ingress.socket_rcv_buf = config.ingress.socket_rcv_buf || 1048576;
    config.ingress.socket_snd_buf = config.ingress.socket_snd_buf || 1048576;

    // Routing defaults
    config.routing.default_web_backend = config.routing.default_web_backend || "frontend:80";
    if (!config.routing.game_servers || !Array.isArray(config.routing.game_servers)) {
        // Fail closed: una migracion nunca debe inventar rutas de clientes.
        config.routing.game_servers = [];
    } else {
        // Enriquecer rutas existentes con campos v2
        config.routing.game_servers = config.routing.game_servers.map(route => ({
            game_id: route.game_id || 1000,
            name: route.name || route.description || `GameID ${route.game_id}`,
            backend_addr: route.backend_addr || "127.0.0.1:9000",
            protocol: route.protocol || "UDP",
            port_range: route.port_range || route.backend_addr.split(':')[1] || "9000",
            description: route.description || `Servidor de Juego ${route.game_id}`,
            health_check: route.health_check || { enabled: false, interval_secs: 10, timeout_secs: 2 }
        }));
    }

    // Advanced Tuning defaults
    if (!config.advanced_tuning) {
        config.advanced_tuning = {
            ebpf_xdp: {
                enabled: true,
                interface: "eth0",
                ddos_mitigation_mode: "STRICT_GAMING",
                max_packet_rate_per_ip: 25000
            },
            tcp_settings: {
                tcp_nodelay: true,
                keepalive_interval_secs: 30,
                congestion_control: "bbr"
            },
            security: {
                rate_limit_conns_per_ip: 150,
                blacklist_enabled: true,
                handshake_timeout_ms: 1500,
                blacklisted_ips: []
            }
        };
    } else if (config.advanced_tuning.security && !config.advanced_tuning.security.blacklisted_ips) {
        config.advanced_tuning.security.blacklisted_ips = [];
    }

    // TLS defaults
    config.tls.cert_path = config.tls.cert_path || "config/certs/cert.pem";
    config.tls.key_path = config.tls.key_path || "config/certs/key.pem";

    // Runtime defaults
    config.runtime.worker_threads = config.runtime.worker_threads || null;
    config.runtime.enable_core_pinning = config.runtime.enable_core_pinning !== undefined ? config.runtime.enable_core_pinning : true;
    config.runtime.io_poll_interval_us = config.runtime.io_poll_interval_us || 100;

    return config;
}

// 1. Obtener la configuración actual de OxideProxy (Migrada a v2.0)
app.get('/api/oxide/config', asyncHandler(async (req, res) => {
    let configObj = {};
    if (fs.existsSync(CONFIG_PATH)) {
        const fileContents = fs.readFileSync(CONFIG_PATH, 'utf8');
        try {
            configObj = yaml.load(fileContents) || {};
        } catch (e) {
            console.error('[OxideControlPanel] Error parseando YAML, usando defaults:', e);
        }
    }
    const migrated = migrateConfigToV2(configObj);
    res.json(migrated);
}));

// 2. Guardar/Actualizar la configuración de OxideProxy
app.post('/api/oxide/config', asyncHandler(async (req, res) => {
    const newConfig = req.body;
    if (!newConfig || !newConfig.ingress || !newConfig.routing) {
        return res.status(400).json({ error: 'Estructura de configuración inválida.' });
    }
    const cleanConfig = migrateConfigToV2(newConfig);
    const yamlStr = yaml.dump(cleanConfig);
    fs.writeFileSync(CONFIG_PATH, yamlStr, 'utf8');
    console.log('[OxideControlPanel] Configuración oxide_proxy.yml actualizada al esquema v2.0 exitosamente.');
    res.json({ success: true, message: 'Configuración guardada correctamente.' });
}));

// 2.5. Obtener la configuración actual del Firewall y eBPF
app.get('/api/oxide/firewall', asyncHandler(async (req, res) => {
    let configObj = {};
    if (fs.existsSync(CONFIG_PATH)) {
        try { configObj = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8')) || {}; } catch(e){}
    }
    const migrated = migrateConfigToV2(configObj);
    res.json({
        ebpf_xdp: migrated.advanced_tuning.ebpf_xdp,
        security: migrated.advanced_tuning.security
    });
}));

// 2.6. Actualizar la configuración del Firewall y eBPF en tiempo real
app.post('/api/oxide/firewall', asyncHandler(async (req, res) => {
    const { ebpf_xdp, security, runtime } = req.body;
    let configObj = {};
    if (fs.existsSync(CONFIG_PATH)) {
        try { configObj = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8')) || {}; } catch(e){}
    }
    const migrated = migrateConfigToV2(configObj);

    if (ebpf_xdp) {
        migrated.advanced_tuning.ebpf_xdp = { ...migrated.advanced_tuning.ebpf_xdp, ...ebpf_xdp };
    }
    if (security) {
        migrated.advanced_tuning.security = { ...migrated.advanced_tuning.security, ...security };
        if (!Array.isArray(migrated.advanced_tuning.security.blacklisted_ips)) {
            migrated.advanced_tuning.security.blacklisted_ips = [];
        }
    }
    if (runtime && typeof runtime.enable_core_pinning === 'boolean') {
        migrated.runtime.enable_core_pinning = runtime.enable_core_pinning;
    }

    const yamlStr = yaml.dump(migrated);
    fs.writeFileSync(CONFIG_PATH, yamlStr, 'utf8');
    console.log('[OxideControlPanel] Reglas de Firewall y eBPF actualizadas en oxide_proxy.yml exitosamente.');
    res.json({ success: true, message: 'Reglas de firewall guardadas correctamente.' });
}));

// 2.7. DNS autoritativo. La clave PowerDNS permanece en este proceso y nunca
// se devuelve al navegador. Solo se admiten zonas declaradas explícitamente.
app.get('/api/oxide/dns/status', asyncHandler(async (_req, res) => {
    const client = powerDnsClient();
    if (!client) {
        return res.json({ available: false, zones: PDNS_MANAGED_ZONES, reason: 'PowerDNS no configurado' });
    }
    const response = await client.get('/zones');
    if (response.status !== 200 || !Array.isArray(response.data)) {
        return res.status(502).json({ error: 'PowerDNS no respondió correctamente.' });
    }
    const zones = response.data
        .map(zone => ({
            name: String(zone.name || '').replace(/\.$/, ''),
            kind: zone.kind || 'Native',
            dnssec: Boolean(zone.dnssec),
            serial: Number(zone.serial || 0)
        }))
        .filter(zone => PDNS_MANAGED_ZONES.includes(zone.name.toLowerCase()));
    res.json({ available: true, zones });
}));

app.get('/api/oxide/dns/zones/:zone/records', asyncHandler(async (req, res) => {
    const zone = normalizedManagedZone(req.params.zone);
    const client = powerDnsClient();
    if (!zone) return res.status(400).json({ error: 'Zona DNS no autorizada.' });
    if (!client) return res.status(503).json({ error: 'PowerDNS no configurado.' });
    const response = await client.get(`/zones/${encodeURIComponent(`${zone}.`)}`);
    if (response.status !== 200) return res.status(502).json({ error: 'No se pudo consultar la zona DNS.' });
    const records = (response.data?.rrsets || []).map(rrset => ({
        name: String(rrset.name || '').replace(/\.$/, ''),
        type: rrset.type,
        ttl: rrset.ttl,
        records: (rrset.records || []).filter(record => !record.disabled).map(record => record.content)
    }));
    res.json({ zone, records });
}));

app.put('/api/oxide/dns/zones/:zone/records', asyncHandler(async (req, res) => {
    const zone = normalizedManagedZone(req.params.zone);
    const client = powerDnsClient();
    if (!zone) return res.status(400).json({ error: 'Zona DNS no autorizada.' });
    if (!client) return res.status(503).json({ error: 'PowerDNS no configurado.' });
    const name = validRecordName(req.body?.name, zone);
    const type = String(req.body?.type || '').toUpperCase();
    const ttl = Number(req.body?.ttl || 300);
    const allowedTypes = new Set(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'SRV', 'CAA']);
    const values = Array.isArray(req.body?.records)
        ? req.body.records.map(value => String(value).trim()).filter(Boolean)
        : [];
    if (!name || !allowedTypes.has(type) || !Number.isInteger(ttl) || ttl < 30 || ttl > 86400) {
        return res.status(400).json({ error: 'Nombre, tipo o TTL de registro no válido.' });
    }
    if (values.length === 0 || values.length > 32 || values.some(value => !validRecordContent(type, value))) {
        return res.status(400).json({ error: 'Contenido del registro no válido.' });
    }
    const response = await client.patch(`/zones/${encodeURIComponent(`${zone}.`)}`, {
        rrsets: [{
            name: `${name}.`, type, ttl, changetype: 'REPLACE',
            records: values.map(content => ({ content, disabled: false }))
        }]
    });
    if (response.status !== 204) return res.status(502).json({ error: 'PowerDNS rechazó el registro.' });
    res.json({ success: true, zone, name, type });
}));

app.delete('/api/oxide/dns/zones/:zone/records', asyncHandler(async (req, res) => {
    const zone = normalizedManagedZone(req.params.zone);
    const client = powerDnsClient();
    const name = validRecordName(req.body?.name, zone);
    const type = String(req.body?.type || '').toUpperCase();
    if (!zone || !name || !/^(A|AAAA|CNAME|TXT|MX|SRV|CAA)$/.test(type)) {
        return res.status(400).json({ error: 'Registro DNS no válido.' });
    }
    if (!client) return res.status(503).json({ error: 'PowerDNS no configurado.' });
    const response = await client.patch(`/zones/${encodeURIComponent(`${zone}.`)}`, {
        rrsets: [{ name: `${name}.`, type, changetype: 'DELETE' }]
    });
    if (response.status !== 204) return res.status(502).json({ error: 'PowerDNS rechazó la eliminación.' });
    res.json({ success: true });
}));

app.get('/api/oxide/ssl/status', asyncHandler(async (_req, res) => {
    const domains = String(process.env.OXIDE_ACME_DOMAINS || '')
        .split(',').map(value => value.trim()).filter(Boolean);
    res.json({
        enabled: String(process.env.OXIDE_ACME_ENABLED || '').toLowerCase() === 'true',
        production: String(process.env.OXIDE_ACME_PRODUCTION || '').toLowerCase() === 'true',
        domains,
        provider: PDNS_MANAGED_ZONES.length > 0 ? 'PowerDNS / ACME DNS-01' : 'OxideProxy ACME TLS-ALPN-01',
        managed_zones: PDNS_MANAGED_ZONES
    });
}));

app.post('/api/oxide/ssl/renew', asyncHandler(async (_req, res) => {
    if (!PDNS_MANAGED_ZONES.length) return res.status(503).json({ error: 'PowerDNS/ACME no configurado.' });
    const response = await axios.post(`${BACKEND_URL}/api/discord/oxide/certificate/renew`, {}, {
        headers: { 'x-api-key': process.env.OXIDE_ROUTE_API_KEY || '' }, timeout: 180000,
        validateStatus: () => true
    });
    if (response.status < 200 || response.status >= 300) {
        return res.status(response.status >= 400 && response.status < 600 ? response.status : 502)
            .json({ error: response.data?.error || 'No se pudo renovar el certificado.' });
    }
    res.json(response.data);
}));

// 3. Telemetría Nativa Avanzada (Producción Real)
app.get('/api/oxide/metrics/advanced', asyncHandler(async (req, res) => {
    // Consultamos el pulso de Prometheus (Real)
    let promUp = false;
    let scrapeDuration = 0.015;
    try {
        const promRes = await axios.get(`${PROMETHEUS_URL}/api/v1/query?query=up`, { timeout: 1500 });
        if (promRes.data && promRes.data.data && promRes.data.data.result.length > 0) {
            promUp = promRes.data.data.result[0].value[1] === "1";
        }
    } catch (e) {
        promUp = false;
    }

    // Métricas del Sistema Operativo / Contenedor (Reales)
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsagePct = ((usedMem / totalMem) * 100).toFixed(1);
    const cpus = os.cpus();
    const loadAvg = os.loadavg();

    // Leemos la configuración actual para obtener la lista de servidores de juego activos
    let configObj = {};
    if (fs.existsSync(CONFIG_PATH)) {
        try { configObj = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8')) || {}; } catch(e){}
    }
    const migrated = migrateConfigToV2(configObj);
    const gameServers = migrated.routing.game_servers || [];

    const { current: currentMetrics, rate } = nativeMetricsWindow();
    const globalActiveConns = Number(currentMetrics?.tcp_active || 0);
    // TCP no expone datagramas como UDP. Una conexión corta puede entregar
    // todo su primer bloque al aceptarse y no generar lecturas posteriores;
    // por eso se suman aperturas y lecturas adicionales como actividad TCP.
    const globalTcpPps = Number((rate('tcp_events_in') + rate('tcp_reads_in')).toFixed(2));
    const globalUdpPps = Math.round(rate('udp_packets_in'));
    const proxyIngressMbps = (rate('tcp_bytes_in') + rate('udp_bytes_in')) * 8 / 1_000_000;
    const globalEgressMbps = (rate('tcp_bytes_out') + rate('udp_bytes_out')) * 8 / 1_000_000;
    const xdpPps = Number(rate('xdp_packets_seen').toFixed(2));
    const xdpIngressMbps = rate('xdp_bytes_seen') * 8 / 1_000_000;

    // La instrumentación actual es global. No se inventan jugadores, latencia
    // ni tráfico por servidor cuando el motor no los proporciona.
    const perServer = gameServers.map(srv => ({
        game_id: srv.game_id,
        name: srv.name,
        protocol: srv.protocol,
        backend_addr: srv.backend_addr,
        active_connections: 0,
        tcp_pps: 0,
        udp_pps: 0,
        total_pps: 0,
        ingress_mbps: 0,
        egress_mbps: 0,
        latency_ms: 0
    }));
    const xdpMode = String(currentMetrics?.xdp_mode || 'disabled');
    const xdpActive = xdpMode === 'xdp-driver' || xdpMode === 'xdp-generic';
    // XDP observa el RX completo antes de que el tráfico llegue al proxy. Cuando
    // está activo es la fuente global autoritativa; sumar ambos duplicaría los
    // paquetes que después también atraviesan los listeners TCP/UDP.
    const totalPps = xdpActive ? xdpPps : globalTcpPps + globalUdpPps;
    const globalIngressMbps = xdpActive ? xdpIngressMbps : proxyIngressMbps;
    // Latency de forwarding aún no está instrumentada: se reporta cero sin
    // fabricar un diferencial fijo. XDP y descartes provienen del kernel.
    const l4Latency = "0.000";
    const ebpfDroppedPps = Number(rate('l4_dropped').toFixed(2));
    const blockedIpsCount = Number(currentMetrics?.l4_blocked_ips || 0);
    const ebpfConfig = migrated.advanced_tuning?.ebpf_xdp || {};

    res.json({
        timestamp: new Date().toISOString(),
        system: {
            cpu_cores: cpus.length,
            cpu_model: cpus[0].model,
            load_average: loadAvg,
            memory: {
                total_bytes: totalMem,
                free_bytes: freeMem,
                used_bytes: usedMem,
                usage_pct: parseFloat(memUsagePct)
            }
        },
        prometheus: {
            status: promUp ? 'online' : 'offline',
            scrape_interval: '15s',
            last_scrape_duration_ms: (scrapeDuration * 1000).toFixed(2)
        },
        proxy_analytics: {
            active_connections: globalActiveConns,
            throughput: {
                tcp_pps: globalTcpPps,
                udp_pps: globalUdpPps,
                xdp_pps: xdpPps,
                total_pps: totalPps,
                ingress_mbps: parseFloat(globalIngressMbps.toFixed(4)),
                egress_mbps: parseFloat(globalEgressMbps.toFixed(4)),
                source: xdpActive ? xdpMode : 'proxy'
            },
            latency: {
                l4_p99_ms: parseFloat(l4Latency),
                l7_tls_ms: "0.00"
            },
            ebpf_mitigation: {
                status: xdpMode === 'xdp-driver'
                    ? `XDP DRIVER ACTIVE (${ebpfConfig.interface || 'eth0'})`
                    : xdpMode === 'xdp-generic'
                        ? `XDP GENERIC ACTIVE (${ebpfConfig.interface || 'eth0'})`
                        : xdpMode === 'memory'
                            ? `MEMORY FALLBACK (${ebpfConfig.interface || 'eth0'})`
                            : 'DISABLED',
                mode: ebpfConfig.ddos_mitigation_mode || 'STRICT_GAMING',
                dropped_packets_per_sec: ebpfDroppedPps,
                blocked_ips_count: blockedIpsCount,
                packets_seen: Number(currentMetrics?.xdp_packets_seen || 0),
                bytes_seen: Number(currentMetrics?.xdp_bytes_seen || 0),
                parse_errors: Number(currentMetrics?.xdp_parse_errors || 0),
                blacklist_drops: Number(currentMetrics?.xdp_blacklist_drops || 0),
                rate_limit_drops: Number(currentMetrics?.xdp_rate_limit_drops || 0)
            },
            per_server: perServer
        }
    });
}));

// 4. Estado general de salud del sistema y backends (Real)
app.get('/api/oxide/status', asyncHandler(async (req, res) => {
    const recentLogs = getLatestLogLines(100);
    const hasActivity = recentLogs.length > 0;
    let configuredBackends = [];
    try {
        const config = migrateConfigToV2(yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8')) || {});
        configuredBackends = config.routing.game_servers.map(route => ({
            id: route.game_id,
            name: route.name || route.description || `GameID ${route.game_id}`,
            addr: route.backend_addr,
            protocol: route.protocol || 'DUAL',
            health: 'UNVERIFIED'
        }));
    } catch (error) {
        console.error('[OxideControlPanel] No se pudo leer la tabla real de rutas:', error.message);
    }
    res.json({
        status: 'online',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        engine: {
            name: 'oxide_proxy_engine',
            status: hasActivity ? 'healthy' : 'idle',
            mode: 'SO_REUSEPORT (Async L4/L7)',
            ingress: ['TCP:8443', 'UDP:8080']
        },
        backends: configuredBackends
    });
}));

// 5. Endpoint de Trazas / Logs en tiempo real filtrados por GameID (Real)
app.get('/api/oxide/logs', asyncHandler(async (req, res) => {
    const filterId = req.query.game_id || 'ALL';
    const realLogs = getLatestLogLines(300);
    if (filterId === 'ALL') {
        res.json({ logs: realLogs });
    } else {
        const filtered = realLogs.filter(line => line.game_id.toString() === filterId || line.game_id === 'SYS');
        res.json({ logs: filtered });
    }
}));

// Fallback para SPA / Frontend
app.get('*', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Manejador de errores general
app.use((err, req, res, next) => {
    console.error('[OxideControlPanel Error]', err);
    if (err?.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Solicitud demasiado grande.' });
    }
    if (err instanceof SyntaxError && Object.prototype.hasOwnProperty.call(err, 'body')) {
        return res.status(400).json({ error: 'JSON no válido.' });
    }
    res.status(500).json({ error: 'Error interno del servidor.' });
});

app.listen(PORT, () => {
    console.log(`🚀 OxideControlPanel v2.0 (L7 Control Plane) escuchando en el puerto ${PORT}`);
    console.log(`📁 Archivo de configuración enlazado: ${CONFIG_PATH}`);
    console.log(`📈 Motor de Telemetría Nativo Híbrido Activo`);
    syncDockerGameServers();
    setInterval(syncDockerGameServers, 15000).unref();
});

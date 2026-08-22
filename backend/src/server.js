import 'dotenv/config'; // 🤖 AÑADIDO: Asegura que el .env se lea antes que cualquier otra cosa
import express from 'express';
import http from 'http';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { config, assertSecureConfig } from './config.js';
import { hasSessionCookie } from './middleware/auth.js';
import { initDb, waitForDb, query } from './db.js';

// Importación de rutas
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import adminDiagnosticsRoutes from './routes/adminDiagnostics.js'; // 🧪 AÑADIDO: Rutas de diagnóstico admin
import installerRoutes from './routes/installer.js';
import serverRoutes from './routes/servers.js';
import fileRoutes from './routes/files.js';
import notificationRoutes from './routes/notifications.js';
import paymentsRoutes from './routes/payments.js';
import ticketRoutes from './routes/tickets.js';
import discordRoutes from './routes/discord.js'; // 🤖 AÑADIDO: Rutas del bot de Discord
import marketplaceRoutes from './routes/marketplace.js'; // 🛒 AÑADIDO: Rutas del Marketplace y Vault
import minecraftRoutes from './routes/minecraft.js'; // ⛏️ AÑADIDO: Rutas específicas de Minecraft
import palworldRoutes from './routes/palworld.js'; // 🥚 AÑADIDO: Rutas específicas de Palworld
import rustRoutes from './routes/rust.js'; // ☢️ AÑADIDO: Rutas específicas de Rust
import cs2Routes from './routes/cs2.js'; // 🔫 AÑADIDO: Rutas específicas de CS2
import valheimRoutes from './routes/valheim.js'; // 🪓 AÑADIDO: Rutas específicas de Valheim
import zomboidRoutes from './routes/zomboid.js'; // 🧟 AÑADIDO: Rutas específicas de Project Zomboid
import arkRoutes from './routes/ark.js';
import sdtdRoutes from './routes/sdtd.js'; // 🦕 AÑADIDO: Rutas específicas de ARK: Survival Ascended
import minecraftModsRoutes from './routes/minecraftMods.js';
import modsRoutes from './routes/mods.js';
import rconRoutes from './routes/rcon.js'; // 🔌 AÑADIDO: Rutas de RCON y Jugadores Live


import cronRoutes from './routes/cron.js'; // 🕒 AÑADIDO: Rutas de Cron Jobs

import pluginsRoutes from './routes/plugins.js';
import { startCronManager } from './services/cronManager.js';
import { runStagingHealthSuite } from './services/stagingHealthTestRunner.js';
import { logger } from './utils/logger.js';
import { requestLogger } from './middleware/requestLogger.js';

// 🤖 ESCUDO ANTI-CRASHEO SILENCIOSO
process.on('uncaughtException', (err) => {
    logger.fatal({ err }, '💥 CRASHEO FATAL (Uncaught Exception)');
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, '💥 PROMESA RECHAZADA (Unhandled Rejection)');
});

assertSecureConfig();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'accelerometer=(), gyroscope=(), magnetometer=()');
    next();
});
app.use(requestLogger);
const allowedOrigins = new Set(
    String(config.corsOrigin || '').split(',').map(origin => origin.trim()).filter(Boolean)
);
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) return callback(null, true);
        const isPrivateIpOrigin = /^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
        if (isPrivateIpOrigin) return callback(null, true);
        return callback(new Error('Origen CORS no permitido.'));
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-API-Key', 'X-Auth-Mode'],
    credentials: true
}));
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self' *; form-action 'self'; script-src 'self' 'unsafe-inline' https: http:; script-src-elem 'self' 'unsafe-inline' https: http:; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline' https: http:; style-src-elem 'self' 'unsafe-inline' https: http:; style-src-attr 'unsafe-inline'; font-src 'self' https: http: data:; img-src * 'self' data: blob: https: http:; connect-src * 'self' ws: wss: https: http:; connect-src 'self' https: http:; frame-src 'self' https: http:; worker-src 'self' blob:; manifest-src 'self'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});
app.use(express.json({ limit: '256kb', strict: true }));
app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !hasSessionCookie(req)) return next();
    const origin = req.get('origin');
    if (!origin) return next();

    const host = req.get('host');
    const forwardedHost = req.get('x-forwarded-host');
    const forwardedProto = req.get('x-forwarded-proto') || req.protocol;

    const requestOrigin = `${req.protocol}://${host}`;
    const forwardedOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : null;
    const isPrivateIpOrigin = /^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);

    if (origin !== requestOrigin && origin !== forwardedOrigin && !allowedOrigins.has(origin) && !isPrivateIpOrigin) {
        return res.status(403).json({ error: 'Origen no permitido para modificaciones de estado.' });
    }
    next();
});

// 🩺 Sondas de Observabilidad y Salud Empresarial (Módulo 4: Production Readiness)
app.get('/healthz', (req, res) => res.status(200).send('OK'));

app.get('/readyz', async (req, res) => {
    const checks = {
        database: 'unknown',
        memory: 'ok',
        uptime_seconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    };

    let isHealthy = true;

    // Verificar conectividad con base de datos
    try {
        await query('SELECT 1');
        checks.database = 'connected';
    } catch (dbErr) {
        checks.database = `error: ${dbErr.message}`;
        isHealthy = false;
    }

    // Monitoreo de huella de memoria del proceso
    const memUsage = process.memoryUsage();
    checks.memory_heap_used_mb = Math.round(memUsage.heapUsed / 1024 / 1024);

    if (isHealthy) {
        return res.status(200).json({ status: 'ready', checks });
    } else {
        return res.status(503).json({ status: 'degraded', checks });
    }
});

// 🔒 Limitador de tasa para rutas de autenticación (Login/Register)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 50, // Limitar a 50 peticiones por IP en 15 mins para endpoints de auth
    message: { error: 'Demasiados intentos de inicio de sesión o registro, por favor intenta de nuevo en 15 minutos.' },
    skip: (req) => req.path === '/me' || req.originalUrl.includes('/auth/me')
});

// 🔒 Limitador de tasa para rutas de administrador
const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 2000, // Aumentado a 2000 porque el panel hace muchas peticiones de actualización
    message: { error: 'Demasiadas solicitudes a la API de admin, intenta de nuevo en 15 minutos.' }
});

const nodeInstallerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes al instalador de nodos.' }
});

const serviceApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Límite temporal de la API de servicio alcanzado.' }
});

const ticketLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Has enviado demasiados tickets. Inténtalo más tarde.' }
});

// Aplicamos el limitador estricto SOLAMENTE a las rutas de autenticación
app.use('/api/auth', authLimiter, authRoutes);

// 🤖 Rutas de la API de Discord
app.use('/api/discord', serviceApiLimiter, discordRoutes);

// Resto de rutas de la API
app.use('/api/admin', adminLimiter, adminRoutes);
app.use('/api/admin/diagnostics', adminLimiter, adminDiagnosticsRoutes);
app.use('/api/nodes', nodeInstallerLimiter, installerRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/tickets', ticketLimiter, ticketRoutes);
app.use('/api/minecraft', minecraftRoutes); 
app.use('/api/palworld', palworldRoutes); 
app.use('/api/rust', rustRoutes); 
app.use('/api/cs2', cs2Routes); 
app.use('/api/valheim', valheimRoutes); 
app.use('/api/minecraft-mods', minecraftModsRoutes);
app.use('/api/mods', modsRoutes);
app.use('/api/zomboid', zomboidRoutes); 
app.use('/api/ark', arkRoutes);
app.use('/api/sdtd', sdtdRoutes); 
app.use('/api/rcon', rconRoutes); 
app.use('/api/cron', cronRoutes);
app.use('/api/plugins', pluginsRoutes);

// Servir archivos estáticos del frontend en desarrollo local (panel, login, etc.)
const frontendPublicDir = path.join(config.projectRoot, 'frontend', 'public');
if (fs.existsSync(frontendPublicDir)) {
    app.use(express.static(frontendPublicDir, { extensions: ['html'] }));
}

app.use((error, req, res, _next) => {
    const reqLog = req.log || logger;
    if (error?.type === 'entity.too.large') {
        reqLog.warn({ reqId: req.id, statusCode: 413 }, 'La solicitud supera el tamaño permitido');
        return res.status(413).json({ error: 'La solicitud supera el tamaño permitido.', requestId: req.id });
    }
    if (error instanceof SyntaxError && error.status === 400) {
        reqLog.warn({ reqId: req.id, statusCode: 400 }, 'JSON inválido en el cuerpo de la petición');
        return res.status(400).json({ error: 'JSON inválido.', requestId: req.id });
    }
    if (error?.message === 'Origen CORS no permitido.') {
        reqLog.warn({ reqId: req.id, statusCode: 403, origin: req.get('origin') }, 'Origen CORS bloqueado');
        return res.status(403).json({ error: 'Origen no permitido.', requestId: req.id });
    }
    reqLog.error({ reqId: req.id, err: error, url: req.originalUrl, method: req.method }, '[HTTP] Error no controlado en servidor');
    return res.status(500).json({ error: 'Error interno del servidor.', requestId: req.id });
});

const server = http.createServer(app);

async function bootstrap() {
    try {
        await waitForDb();
        await initDb();
        startCronManager();

        server.listen(config.port, () => {
            console.log(`---------------------------------------------------`);
            console.log(`🚀 API RAGENODES escuchando en ${config.port}`);
            console.log(`🛡️  Rate Limit: Global (1500) | Files (Unlimited) | Auth (50)`);
            console.log(`⚙️  Modo: Optimizando para subida masiva de recursos.`);
            console.log(`🤖 API Discord: Lista para conectar con el bot`);
            console.log(`🧪 Diagnóstico Admin: Disponible en /api/admin/diagnostics/run`);
            console.log(`🧩 Workers externos: backups, docker-events y stats se ejecutan en servicios separados.`);
            console.log(`---------------------------------------------------`);

            if (process.env.NODE_ENV === 'staging' || process.env.STAGING_AUTO_TEST === 'true') {
                setTimeout(() => {
                    runStagingHealthSuite('SERVER_BOOTSTRAP').catch(console.error);
                }, 3000);
            }
        });
    } catch (error) {
        console.error("❌ Error durante el inicio del servidor:", error);
    }
}

if (process.env.NODE_ENV !== 'test') {
    bootstrap();
}

export { app, server, bootstrap };

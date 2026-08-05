import 'dotenv/config'; // 🤖 AÑADIDO: Asegura que el .env se lea antes que cualquier otra cosa
import express from 'express';
import http from 'http';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { config } from './config.js';
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

// 🤖 AÑADIDO: ESCUDO ANTI-CRASHEO SILENCIOSO
process.on('uncaughtException', (err) => {
    console.error('💥 CRASHEO FATAL (Uncaught Exception):', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 PROMESA RECHAZADA (Unhandled Rejection):', reason);
});

const app = express();
app.use(cors());
app.use(express.json());

// 🔒 Limitador de tasa para rutas de autenticación
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 50, // Limitar a 50 peticiones por IP en 15 mins para endpoints de auth
    message: { error: 'Demasiados intentos de inicio de sesión o registro, por favor intenta de nuevo en 15 minutos.' }
});

// 🔒 Limitador de tasa para rutas de administrador
const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 2000, // Aumentado a 2000 porque el panel hace muchas peticiones de actualización
    message: { error: 'Demasiadas solicitudes a la API de admin, intenta de nuevo en 15 minutos.' }
});


// Aplicamos el limitador estricto SOLAMENTE a las rutas de autenticación
app.use('/api/auth', authLimiter, authRoutes);

// 🤖 AÑADIDO: Rutas de la API de Discord
app.use('/api/discord', discordRoutes);

// Resto de rutas de la API
app.use('/api/admin', adminLimiter, adminRoutes);

// 🧪 AÑADIDO: Rutas de diagnóstico avanzado del panel admin
app.use('/api/admin/diagnostics', adminLimiter, adminDiagnosticsRoutes);

// 🚀 AUTO-LINK NODES (Sin Auth, Protegido por API_KEY)
app.use('/api/nodes', installerRoutes);

app.use('/api/servers', serverRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/tickets', ticketRoutes);
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
app.use('/api/cron', cronRoutes); // 🕒 AÑADIDO: Rutas de Cron Jobs

import pluginsRoutes from './routes/plugins.js'; // 🔌 AÑADIDO: Rutas de Plugins
app.use('/api/plugins', pluginsRoutes); // 🔌 AÑADIDO: Rutas de Plugins

import { startCronManager } from './services/cronManager.js';

const server = http.createServer(app);

server.listen(config.port, async () => {
  try {
    await waitForDb();
    await initDb();
    startCronManager(); // 🕒 AÑADIDO: Iniciar gestor de tareas programadas

    console.log(`---------------------------------------------------`);
    console.log(`🚀 API RAGENODES escuchando en ${config.port}`);
    console.log(`🛡️  Rate Limit: Global (1500) | Files (Unlimited) | Auth (15)`);
    console.log(`⚙️  Modo: Optimizando para subida masiva de recursos.`);
    console.log(`🤖 API Discord: Lista para conectar con el bot`);
    console.log(`🧪 Diagnóstico Admin: Disponible en /api/admin/diagnostics/run`);
    console.log(`🧩 Workers externos: backups, docker-events y stats se ejecutan en servicios separados.`);
console.log(`---------------------------------------------------`);
  } catch (error) {
    console.error("❌ Error durante el inicio del servidor:", error);
  }
});

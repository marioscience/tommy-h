import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { config } from './config.js';
import { runMigrations } from './migrations.js';

import { createClient } from 'redis';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: parseInt(process.env.PG_POOL_MAX || '25', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
export async function query(text, params = []) { return pool.query(text, params); }

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback((text, params = []) => client.query(text, params));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' });
redisClient.on('error', (err) => {
  if (process.env.NODE_ENV !== 'test') {
    console.log('Redis Client Error', err.message);
  }
});

let isRedisConnecting = false;
let redisDisabledUntil = 0;

async function ensureRedis() {
  if (Date.now() < redisDisabledUntil) return;
  if (!redisClient.isOpen && !isRedisConnecting && process.env.NODE_ENV !== 'test') {
    isRedisConnecting = true;
    try {
      await Promise.race([
        redisClient.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connection timeout')), 1000))
      ]);
    } catch (e) {
      redisDisabledUntil = Date.now() + 60000;
      try { await redisClient.disconnect(); } catch (dcErr) {}
    } finally {
      isRedisConnecting = false;
    }
  }
}

export async function queryCached(text, params = [], ttlSeconds = 3) {
  try {
    await ensureRedis();
    if (redisClient.isOpen) {
      const hash = crypto.createHash('md5').update(text + ':' + JSON.stringify(params)).digest('hex');
      const key = `query:${hash}`;
      const cached = await redisClient.get(key);
      if (cached) {
        return JSON.parse(cached);
      }
      const result = await query(text, params);
      await redisClient.setEx(key, ttlSeconds, JSON.stringify(result));
      return result;
    }
    return query(text, params);
  } catch (e) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('Redis cache error, falling back to DB:', e.message);
    }
    return query(text, params);
  }
}

export async function waitForDb() {
  for (let i = 0; i < 20; i++) {
    try { await query('SELECT 1'); return true; }
    catch { await new Promise(r => setTimeout(r, 1500)); }
  }
  throw new Error("DB Connection Failed");
}

/**
 * 🧹 PURGA AUTOMÁTICA DE LOGS
 * Ejecuta una limpieza cada 24 horas para no sobrecargar el sistema.
 */
async function startDbMaintenance() {
    console.log("🧹 [DB] Iniciando mantenimiento de base de datos...");
    setInterval(async () => {
        try {
            const res = await query(`
                DELETE FROM audit_logs
                WHERE created_at < NOW() - INTERVAL '30 days'
                  AND action NOT LIKE 'payment.%'
                  AND action NOT LIKE 'legal.%'
                  AND action NOT LIKE 'billing.%'
                  AND action NOT LIKE 'admin.dispute_evidence.%'
            `);
            await query(`
                DELETE FROM audit_logs
                WHERE created_at < NOW() - INTERVAL '24 months'
            `);
            if (res.rowCount > 0) console.log(`🧹 [DB] Mantenimiento: Purgados ${res.rowCount} registros de auditoría antiguos.`);
            
            // También purgamos estadísticas históricas de más de 7 días para no inflar la DB
            const statsRes = await query("DELETE FROM server_stats_history WHERE created_at < NOW() - INTERVAL '7 days'");
            if (statsRes.rowCount > 0) console.log(`🧹 [DB] Mantenimiento: Purgadas ${statsRes.rowCount} muestras de estadísticas antiguas.`);
        } catch (e) {
            console.error("❌ Error en mantenimiento de DB:", e);
        }
    }, 24 * 60 * 60 * 1000); // Cada 24 horas
}

export async function seedInitialData() {
  // 1. Insertar Nodo Maestro si no existe
  await query(`
    INSERT INTO nodes (id, name, ip_address, api_key, status)
    VALUES (0, 'Master Node (Local)', 'localhost', 'internal', 'active')
    ON CONFLICT (id) DO NOTHING;
  `);

  // 2. Insertar/Actualizar Planes de Hosting por defecto
  await query(`
    INSERT INTO hosting_plans (id, name, price, paypal_plan_id, features) 
    VALUES 
      ('community_starter', 'Community Starter', 14.99, '', '{"ram": "8GB", "cores": 4, "ssd": "50GB", "webtop": true, "max_slots": 2, "min_ram_gb": 4, "bots": true, "web": true}'),
      ('community_pro', 'Community Pro', 24.99, '', '{"ram": "16GB", "cores": 6, "ssd": "100GB", "webtop": true, "priority_support": true, "max_slots": 4, "min_ram_gb": 4, "bots": true, "web": true}'),
      ('community_network', 'Community Network', 49.99, '', '{"ram": "32GB", "cores": 8, "ssd": "250GB", "webtop": true, "priority_support": true, "all_games": true, "max_slots": 8, "min_ram_gb": 4, "bots": true, "web": true}'),
      ('hobby', 'Plan Hobby', 11.99, 'P-25179313MG825601RNHFTWTA', '{"ram": "4GB", "cores": 2, "ssd": "30GB", "max_slots": 1, "min_ram_gb": 2}'),
      ('standard', 'Plan Standard', 24.99, 'P-4SD43202755277406NHFTYVI', '{"ram": "8GB", "cores": 4, "ssd": "80GB", "webtop": true, "max_slots": 1, "min_ram_gb": 2}'),
      ('premium', 'Plan Premium', 44.99, 'P-9DP98865NX609680UNHFT2MA', '{"ram": "16GB", "cores": 6, "ssd": "150GB", "webtop": true, "priority_support": true, "max_slots": 2, "min_ram_gb": 2}'),
      ('platinum', 'Plan Platinum', 69.99, 'P-0S609209WA282443LNIBOWKA', '{"ram": "32GB", "cores": 8, "ssd": "300GB", "webtop": true, "priority_support": true, "all_games": true, "max_slots": 4, "min_ram_gb": 2}'),
      ('game_cs2', 'CS2 Dedicated', 6.99, '', '{"ram": "4GB", "cores": 2, "ssd": "65GB", "game": "cs2"}'),
      ('game_valheim', 'Valheim Dedicated', 5.99, '', '{"ram": "4GB", "cores": 2, "ssd": "15GB", "game": "valheim"}'),
      ('game_minecraft', 'Minecraft Dedicated', 5.99, '', '{"ram": "4GB", "cores": 2, "ssd": "15GB", "game": "minecraft"}'),
      ('game_fivem', 'FiveM Dedicated', 9.99, '', '{"ram": "6GB", "cores": 2.5, "ssd": "25GB", "game": "fivem"}'),
      ('game_zomboid', 'Project Zomboid', 7.99, '', '{"ram": "6GB", "cores": 2.5, "ssd": "25GB", "game": "zomboid"}'),
      ('game_sdtd', '7 Days to Die', 7.99, '', '{"ram": "8GB", "cores": 3, "ssd": "40GB", "game": "sdtd"}'),
      ('game_rust', 'Rust Dedicated', 12.99, '', '{"ram": "8GB", "cores": 3.5, "ssd": "40GB", "game": "rust"}'),
      ('game_palworld', 'Palworld Dedicated', 16.99, '', '{"ram": "16GB", "cores": 4, "ssd": "40GB", "game": "palworld"}'),
      ('game_ark', 'ARK Dedicated', 19.99, '', '{"ram": "16GB", "cores": 5, "ssd": "100GB", "game": "ark"}'),
      ('app_discordbot', 'Discord Bot Hosting', 1.99, '', '{"ram": "512MB", "cores": 1, "ssd": "5GB", "game": "discordbot"}'),
      ('app_wordpress', 'WordPress Hosting', 3.99, '', '{"ram": "2GB", "cores": 2, "ssd": "15GB", "game": "wordpress"}'),
      ('app_database', 'MySQL Dedicated', 2.99, '', '{"ram": "1GB", "cores": 1, "ssd": "10GB", "game": "database"}')
    ON CONFLICT (id) DO UPDATE SET 
      price = EXCLUDED.price,
      paypal_plan_id = COALESCE(NULLIF(hosting_plans.paypal_plan_id, ''), EXCLUDED.paypal_plan_id),
      features = EXCLUDED.features;
    
    DELETE FROM hosting_plans WHERE id = 'plan_platinum';
  `);

  // 3. Usuario administrador inicial (Bootstrap)
  if (config.adminUser && config.adminPass) {
    const existingAdmin = await query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (!existingAdmin.rowCount) {
      const hash = await bcrypt.hash(config.adminPass, 12);
      await query(
        'INSERT INTO users (username, password_hash, role, plan, server_limit, is_verified) VALUES ($1, $2, $3, $4, $5, true)',
        [config.adminUser, hash, 'admin', 'premium', 100]
      );
    }
  }
}

export async function initDb() {
  // 1. Ejecutar migraciones estructurales de base de datos
  await runMigrations(query, withTransaction);

  // 2. Sembrar datos esenciales (Seeds)
  await seedInitialData();

  // 3. Iniciar tareas de mantenimiento
  startDbMaintenance();
}

export async function logAudit(userIdOrReq, action, details = {}, ipOverride = null, uaOverride = null) {
  let userId = null;
  let ip = ipOverride;
  let ua = uaOverride;

  if (userIdOrReq && typeof userIdOrReq === 'object' && userIdOrReq.user) {
    userId = userIdOrReq.user.sub;
    const forwarded = userIdOrReq.headers?.['x-forwarded-for'];
    ip = ipOverride || (forwarded ? forwarded.split(',')[0].trim() : userIdOrReq.ip) || userIdOrReq.connection?.remoteAddress || null;
    ua = uaOverride || userIdOrReq.headers?.['user-agent'] || null;
    if (!details.serverId && userIdOrReq.params?.id) details.serverId = userIdOrReq.params.id;
  } else if (userIdOrReq && typeof userIdOrReq !== 'object') {
    userId = userIdOrReq;
  }

  let finalUserId = null;
  if (userId && !isNaN(userId)) {
    finalUserId = parseInt(userId);
  }

  try {
    await query('INSERT INTO audit_logs (user_id, action, details, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)', 
      [finalUserId, action, JSON.stringify(details), ip, ua]
    );
  } catch (e) {
    console.warn('[AuditLog] Warning logging audit event:', e.message);
  }
}

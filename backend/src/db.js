import pg from 'pg';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { runMigrations } from './migrations.js';

import { createClient } from 'redis';

export const pool = new pg.Pool({ connectionString: config.databaseUrl });
export async function query(text, params = []) { return pool.query(text, params); }

export const redisClient = createClient({ url: 'redis://redis:6379' });
redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.connect().catch(console.error);

export async function queryCached(text, params = [], ttlSeconds = 3) {
  try {
    const key = `query:${Buffer.from(text).toString('base64')}:${JSON.stringify(params)}`;
    const cached = await redisClient.get(key);
    if (cached) {
      return JSON.parse(cached);
    }
    const result = await query(text, params);
    await redisClient.setEx(key, ttlSeconds, JSON.stringify(result));
    return result;
  } catch (e) {
    console.error('Redis cache error, falling back to DB:', e.message);
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

export async function initDb() {
  await query(`
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'client',
      plan TEXT NOT NULL DEFAULT 'hobby',
      server_limit INTEGER NOT NULL DEFAULT 1,
      expires_at TIMESTAMPTZ,
      is_verified BOOLEAN DEFAULT false,
      verify_token TEXT,
      reset_token TEXT,
      reset_expires TIMESTAMPTZ,
      extra_disk_gb INTEGER NOT NULL DEFAULT 0,
      disk_sub_id TEXT,
      token_version INTEGER DEFAULT 1,
      discord_id TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      paypal_order_id TEXT UNIQUE NOT NULL,
      plan_name TEXT NOT NULL,
      amount DECIMAL(10,2),
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invite_keys (
      id SERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE, created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
      max_uses INTEGER NOT NULL DEFAULT 1, uses INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS servers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, slug TEXT NOT NULL, template TEXT NOT NULL, runtime_plan TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'creating', fivem_port INTEGER NOT NULL UNIQUE, txadmin_port INTEGER NOT NULL UNIQUE,
      blender_port INTEGER UNIQUE, blender_pass TEXT,
      container_name TEXT NOT NULL UNIQUE, data_path TEXT NOT NULL, license_key_hint TEXT NOT NULL,
      txadmin_url TEXT NOT NULL, db_name TEXT, db_user TEXT, db_pass TEXT,
      expires_at TIMESTAMPTZ,
      backup_time TEXT DEFAULT '04:00',
      cluster_id TEXT,
      auto_restart_time TEXT DEFAULT '06:00',
      auto_restart_enabled BOOLEAN DEFAULT false,
      backup_before_restart BOOLEAN DEFAULT true,
      discord_webhook_url TEXT,
      discord_webhook_events JSONB DEFAULT '["online", "offline", "player_join", "player_leave", "update"]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE servers ADD COLUMN IF NOT EXISTS cluster_id TEXT;
    ALTER TABLE servers ADD COLUMN IF NOT EXISTS auto_restart_time TEXT DEFAULT '06:00';
    ALTER TABLE servers ADD COLUMN IF NOT EXISTS auto_restart_enabled BOOLEAN DEFAULT false;
    ALTER TABLE servers ADD COLUMN IF NOT EXISTS backup_before_restart BOOLEAN DEFAULT true;
    ALTER TABLE servers ADD COLUMN IF NOT EXISTS discord_webhook_url TEXT;
    ALTER TABLE servers ADD COLUMN IF NOT EXISTS discord_webhook_events JSONB DEFAULT '["online", "offline", "player_join", "player_leave", "update"]'::jsonb;

    CREATE TABLE IF NOT EXISTS server_subusers (
      id SERIAL PRIMARY KEY,
      server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      permissions JSONB NOT NULL DEFAULT '["restart", "console"]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(server_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}'::jsonb, 
      ip_address TEXT, user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS backups (
      id SERIAL PRIMARY KEY,
      server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
      filename VARCHAR(255) NOT NULL,
      size_bytes BIGINT DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bot_knowledge (
      id SERIAL PRIMARY KEY,
      patron TEXT NOT NULL,
      respuesta TEXT NOT NULL,
      contexto TEXT DEFAULT 'general',
      peso FLOAT NOT NULL DEFAULT 1.0,
      veces_usado INTEGER NOT NULL DEFAULT 0,
      creado_por TEXT NOT NULL DEFAULT 'sistema',
      activo BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bot_ticket_logs (
      id BIGSERIAL PRIMARY KEY,
      discord_user_id TEXT NOT NULL,
      discord_username TEXT,
      canal_id TEXT NOT NULL,
      mensajes JSONB NOT NULL DEFAULT '[]'::jsonb,
      intenciones_detectadas TEXT[],
      resuelto_por_ia BOOLEAN DEFAULT false,
      escalado_a_humano BOOLEAN DEFAULT false,
      patron_usado_id INTEGER REFERENCES bot_knowledge(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS bot_stats (
      id BIGSERIAL PRIMARY KEY,
      intencion TEXT NOT NULL DEFAULT 'desconocida',
      resuelto BOOLEAN NOT NULL DEFAULT false,
      escalado BOOLEAN NOT NULL DEFAULT false,
      patron_id INTEGER REFERENCES bot_knowledge(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS server_stats_history (
      id BIGSERIAL PRIMARY KEY,
      server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
      cpu FLOAT NOT NULL,
      ram FLOAT NOT NULL,
      ram_gb FLOAT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS marketplace_scripts (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      price DECIMAL(10,2) NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0.0',
      author_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL DEFAULT 'other',
      icon_type TEXT DEFAULT 'default',
      icon_color TEXT DEFAULT '#38bdf8',
      file_path TEXT,
      image_url TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS marketplace_licenses (
      id SERIAL PRIMARY KEY,
      script_id INTEGER REFERENCES marketplace_scripts(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      license_key TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS vendor_applications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      discord_username TEXT NOT NULL,
      portfolio_url TEXT,
      experience_summary TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      admin_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS hosting_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      paypal_plan_id TEXT,
      image_url TEXT,
      features JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );


    CREATE TABLE IF NOT EXISTS nodes (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      ip_address TEXT NOT NULL UNIQUE,
      api_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      ram_total_gb INTEGER NOT NULL DEFAULT 0,
      cpu_cores INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS server_cron_jobs (
      id SERIAL PRIMARY KEY,
      server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
      time_hh_mm TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Insertar Nodo Maestro si no existe
  await query(`
    INSERT INTO nodes (id, name, ip_address, api_key, status)
    VALUES (0, 'Master Node (Local)', 'localhost', 'internal', 'active')
    ON CONFLICT (id) DO NOTHING;
  `);
  await runMigrations();

// 🚀 OPTIMIZACIÓN: Índices Esenciales
    const indices = [
        "CREATE INDEX IF NOT EXISTS idx_servers_owner_id ON servers(owner_id)",
        "CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id)",
        "CREATE INDEX IF NOT EXISTS idx_stats_history_server_created ON server_stats_history(server_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON audit_logs(user_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_backups_server_id ON backups(server_id)",
        "CREATE INDEX IF NOT EXISTS idx_server_subusers_user_id ON server_subusers(user_id)"
    ];
  
  for (const idx of indices) {
      try { await query(idx); } catch (e) {}
  }

  // Iniciar mantenimiento automático
  startDbMaintenance();

  // Planes iniciales
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

  // Usuario admin
  const adminUser = config.adminUser || 'admin';
  const adminPass = config.adminPass || 'admin123';
  const existing = await query('SELECT id FROM users WHERE username = $1', [adminUser]);
  if (!existing.rowCount) {
    const hash = await bcrypt.hash(adminPass, 12);
    await query(
        'INSERT INTO users (username, password_hash, role, plan, server_limit, is_verified) VALUES ($1, $2, $3, $4, $5, true)',
        [adminUser, hash, 'admin', 'premium', 100]
    );
  }
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

  await query('INSERT INTO audit_logs (user_id, action, details, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)', 
    [finalUserId, action, JSON.stringify(details), ip, ua]
  );
}

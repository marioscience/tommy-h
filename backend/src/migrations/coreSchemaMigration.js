/** Immutable bootstrap schema. Later changes belong to incremental migrations. */
export const coreSchemaMigration = {
  id: '202601010001_initial_core_schema',
  description: 'Esquema base inicial: usuarios, servidores, pagos, nodos y auditoria',
  statements: [
    'CREATE EXTENSION IF NOT EXISTS "pgcrypto"',
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, email TEXT UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'client',
      plan TEXT NOT NULL DEFAULT 'hobby', server_limit INTEGER NOT NULL DEFAULT 1,
      expires_at TIMESTAMPTZ, is_verified BOOLEAN DEFAULT false, verify_token TEXT,
      reset_token TEXT, reset_expires TIMESTAMPTZ, extra_disk_gb INTEGER NOT NULL DEFAULT 0,
      disk_sub_id TEXT, token_version INTEGER DEFAULT 1, discord_id TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      paypal_order_id TEXT UNIQUE NOT NULL, plan_name TEXT NOT NULL, amount DECIMAL(10,2),
      status TEXT NOT NULL DEFAULT 'COMPLETED', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS invite_keys (
      id SERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE,
      created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
      max_uses INTEGER NOT NULL DEFAULT 1, uses INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS nodes (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, ip_address TEXT NOT NULL UNIQUE,
      api_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      ram_total_gb INTEGER NOT NULL DEFAULT 0, cpu_cores INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS servers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, slug TEXT NOT NULL, template TEXT NOT NULL, runtime_plan TEXT NOT NULL,
      mc_version TEXT NOT NULL DEFAULT '1.21.4', mc_type TEXT NOT NULL DEFAULT 'PAPER', cpuset TEXT,
      status TEXT NOT NULL DEFAULT 'creating', fivem_port INTEGER NOT NULL UNIQUE,
      txadmin_port INTEGER NOT NULL UNIQUE, blender_port INTEGER UNIQUE, blender_pass TEXT,
      container_name TEXT NOT NULL UNIQUE, data_path TEXT NOT NULL, license_key_hint TEXT NOT NULL,
      txadmin_url TEXT NOT NULL, db_name TEXT, db_user TEXT, db_pass TEXT,
      node_id INTEGER DEFAULT 0 REFERENCES nodes(id) ON DELETE SET NULL, expires_at TIMESTAMPTZ,
      backup_time TEXT DEFAULT '04:00', cluster_id TEXT, auto_restart_time TEXT DEFAULT '06:00',
      auto_restart_enabled BOOLEAN DEFAULT false, backup_before_restart BOOLEAN DEFAULT true,
      discord_webhook_url TEXT,
      discord_webhook_events JSONB DEFAULT '["online", "offline", "player_join", "player_leave", "update"]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL, ip_address TEXT, details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  ]
};

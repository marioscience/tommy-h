/**
 * 🗄️ Declaraciones de Migraciones SQL para RageNodes Ultimate
 */

export const migrations = [
  {
    id: '202601010001_initial_core_schema',
    description: 'Esquema base inicial: usuarios, servidores, pagos, nodos y auditoria',
    statements: [
      'CREATE EXTENSION IF NOT EXISTS "pgcrypto"',

      `CREATE TABLE IF NOT EXISTS users (
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
      )`,

      `CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        paypal_order_id TEXT UNIQUE NOT NULL,
        plan_name TEXT NOT NULL,
        amount DECIMAL(10,2),
        status TEXT NOT NULL DEFAULT 'COMPLETED',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS invite_keys (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
        max_uses INTEGER NOT NULL DEFAULT 1,
        uses INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS nodes (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        ip_address TEXT NOT NULL UNIQUE,
        api_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        ram_total_gb INTEGER NOT NULL DEFAULT 0,
        cpu_cores INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS servers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        template TEXT NOT NULL,
        runtime_plan TEXT NOT NULL,
        mc_version TEXT NOT NULL DEFAULT '1.21.4',
        mc_type TEXT NOT NULL DEFAULT 'PAPER',
        cpuset TEXT,
        status TEXT NOT NULL DEFAULT 'creating',
        fivem_port INTEGER NOT NULL UNIQUE,
        txadmin_port INTEGER NOT NULL UNIQUE,
        blender_port INTEGER UNIQUE,
        blender_pass TEXT,
        container_name TEXT NOT NULL UNIQUE,
        data_path TEXT NOT NULL,
        license_key_hint TEXT NOT NULL,
        txadmin_url TEXT NOT NULL,
        db_name TEXT,
        db_user TEXT,
        db_pass TEXT,
        node_id INTEGER DEFAULT 0 REFERENCES nodes(id) ON DELETE SET NULL,
        expires_at TIMESTAMPTZ,
        backup_time TEXT DEFAULT '04:00',
        cluster_id TEXT,
        auto_restart_time TEXT DEFAULT '06:00',
        auto_restart_enabled BOOLEAN DEFAULT false,
        backup_before_restart BOOLEAN DEFAULT true,
        discord_webhook_url TEXT,
        discord_webhook_events JSONB DEFAULT '["online", "offline", "player_join", "player_leave", "update"]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        ip_address TEXT,
        details JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    ]
  },
  {
    id: '202601150001_schedules_table',
    description: 'Tabla de tareas programadas (schedules / cron)',
    statements: [
      `CREATE TABLE IF NOT EXISTS schedules (
        id SERIAL PRIMARY KEY,
        server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        action TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        last_run TIMESTAMPTZ,
        next_run TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    ]
  },
  {
    id: '202601200001_subusers_table',
    description: 'Tabla de subusuarios y permisos por servidor',
    statements: [
      `CREATE TABLE IF NOT EXISTS subusers (
        id SERIAL PRIMARY KEY,
        server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(server_id, user_id)
      )`
    ]
  },
  {
    id: '202602010001_marketplace_scripts',
    description: 'Tabla de scripts y add-ons del Marketplace con protección Vault',
    statements: [
      `CREATE TABLE IF NOT EXISTS marketplace_scripts (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        download_url TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '1.0.0',
        category TEXT NOT NULL DEFAULT 'general',
        game TEXT NOT NULL DEFAULT 'fivem',
        downloads_count INTEGER NOT NULL DEFAULT 0,
        is_verified BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    ]
  },
  {
    id: '202602100001_marketplace_licenses',
    description: 'Licencias adquiridas de scripts del Marketplace con binding de servidor',
    statements: [
      `CREATE TABLE IF NOT EXISTS marketplace_licenses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        script_id INTEGER NOT NULL REFERENCES marketplace_scripts(id) ON DELETE CASCADE,
        license_key TEXT UNIQUE NOT NULL,
        bound_server_id UUID REFERENCES servers(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    ]
  },
  {
    id: '202603010001_performance_indexes',
    description: 'Índices pesados para consultas de alto rendimiento y aceleración de dashboard',
    statements: [
      'CREATE INDEX IF NOT EXISTS idx_servers_owner_id ON servers(owner_id)',
      'CREATE INDEX IF NOT EXISTS idx_servers_node_id ON servers(node_id)',
      'CREATE INDEX IF NOT EXISTS idx_servers_status ON servers(status)',
      'CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)',
      'CREATE INDEX IF NOT EXISTS idx_schedules_server_id ON schedules(server_id)',
      'CREATE INDEX IF NOT EXISTS idx_subusers_server_id ON subusers(server_id)',
      'CREATE INDEX IF NOT EXISTS idx_subusers_user_id ON subusers(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_marketplace_licenses_user_id ON marketplace_licenses(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_marketplace_licenses_key ON marketplace_licenses(license_key)'
    ]
  },
  {
    id: '202604010001_billing_dispute_evidence',
    description: 'Tabla de evidencia de auditoría para disputas de cobro (PayPal Chargebacks)',
    statements: [
      `CREATE TABLE IF NOT EXISTS dispute_evidences (
        id SERIAL PRIMARY KEY,
        payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        dispute_id TEXT UNIQUE NOT NULL,
        reason TEXT NOT NULL,
        evidence_data JSONB NOT NULL,
        ip_logs JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'generated',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    ]
  },
  {
    id: '202605010001_server_backups_table',
    description: 'Tabla de backups locales y remotos para restauración rápida',
    statements: [
      `CREATE TABLE IF NOT EXISTS backups (
        id SERIAL PRIMARY KEY,
        server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        filename TEXT NOT NULL,
        size_bytes BIGINT NOT NULL DEFAULT 0,
        storage_type TEXT NOT NULL DEFAULT 'local',
        is_automatic BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'CREATE INDEX IF NOT EXISTS idx_backups_server_id ON backups(server_id)'
    ]
  },
  {
    id: '202605010002_backup_checksums',
    description: 'Hash SHA-256 para validar backups antes de restaurarlos',
    statements: [
      'ALTER TABLE backups ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT',
      `ALTER TABLE backups DROP CONSTRAINT IF EXISTS backups_checksum_sha256_format`,
      `ALTER TABLE backups ADD CONSTRAINT backups_checksum_sha256_format
       CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$')`
    ]
  },
  {
    id: '202606010001_node_telemetry_history',
    description: 'Historial de métricas de telemetría de nodos (CPU, RAM, Disco, Ancho de Banda)',
    statements: [
      `CREATE TABLE IF NOT EXISTS node_telemetry (
        id BIGSERIAL PRIMARY KEY,
        node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        cpu_usage_pct REAL NOT NULL,
        ram_used_bytes BIGINT NOT NULL,
        ram_total_bytes BIGINT NOT NULL,
        disk_used_bytes BIGINT NOT NULL,
        disk_total_bytes BIGINT NOT NULL,
        network_rx_bytes BIGINT NOT NULL DEFAULT 0,
        network_tx_bytes BIGINT NOT NULL DEFAULT 0,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'CREATE INDEX IF NOT EXISTS idx_node_telemetry_node_time ON node_telemetry(node_id, recorded_at DESC)'
    ]
  },
  {
    id: '202607010001_knowledge_base_ai',
    description: 'Base de conocimiento vectorial / sintética para el Bot de Soporte de Discord',
    statements: [
      `CREATE TABLE IF NOT EXISTS discord_knowledge (
        id SERIAL PRIMARY KEY,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        tags TEXT[] DEFAULT '{}',
        use_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    ]
  },
  {
    id: '202608010001_vendor_portal_tables',
    description: 'Tablas para el Portal de Desarrolladores / Vendors del Marketplace',
    statements: [
      `CREATE TABLE IF NOT EXISTS vendors (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        payout_email TEXT NOT NULL,
        total_sales DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        commission_rate DECIMAL(4,2) NOT NULL DEFAULT 0.15,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    ]
  },
  {
    id: '202608100001_user_billing_profiles',
    description: 'Información ampliada de facturación del cliente para facturas PDF',
    statements: [
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name TEXT",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS vat_number TEXT",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS address_line1 TEXT",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS postal_code TEXT"
    ]
  },
  {
    id: '202608150001_paypal_vault_subscriptions',
    description: 'Soporte para suscripciones recurrentes automáticas de PayPal (Vault)',
    statements: [
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS paypal_sub_id TEXT UNIQUE",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_status TEXT DEFAULT 'INACTIVE'",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS next_billing_date TIMESTAMPTZ",
      'CREATE INDEX IF NOT EXISTS idx_users_paypal_sub_id ON users(paypal_sub_id) WHERE paypal_sub_id IS NOT NULL',
      'CREATE INDEX IF NOT EXISTS idx_users_disk_sub_id ON users(disk_sub_id) WHERE disk_sub_id IS NOT NULL',
      `CREATE TABLE IF NOT EXISTS paypal_webhook_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'processing',
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ
      )`
    ]
  },
  {
    id: '202608170002_server_game_runtime_columns',
    statements: [
      "ALTER TABLE servers ADD COLUMN IF NOT EXISTS mc_version TEXT NOT NULL DEFAULT '1.21.4'",
      "ALTER TABLE servers ADD COLUMN IF NOT EXISTS mc_type TEXT NOT NULL DEFAULT 'PAPER'",
      'ALTER TABLE servers ADD COLUMN IF NOT EXISTS cpuset TEXT'
    ]
  },
  {
    id: '202608200002_create_disk_plans_table',
    description: 'Tabla de expansiones de disco NVMe para clientes',
    statements: [
      `CREATE TABLE IF NOT EXISTS disk_plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        gb_amount INTEGER NOT NULL,
        paypal_plan_id TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        image_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `INSERT INTO disk_plans (id, name, price, gb_amount, is_active) VALUES
        ('disk_5gb', 'Pack +5 GB NVMe', 2.99, 5, true),
        ('disk_10gb', 'Pack +10 GB NVMe', 4.99, 10, true),
        ('disk_20gb', 'Pack +20 GB NVMe', 8.99, 20, true),
        ('disk_50gb', 'Pack +50 GB NVMe', 19.99, 50, true)
       ON CONFLICT (id) DO NOTHING`
    ]
  },
  {
    id: '202608210001_marketplace_scripts_game_column',
    description: 'Añadir columna game a la tabla marketplace_scripts',
    statements: [
      "ALTER TABLE marketplace_scripts ADD COLUMN IF NOT EXISTS game TEXT NOT NULL DEFAULT 'fivem'"
    ]
  },
  {
    id: '202608210002_create_edge_proxies_table',
    description: 'Tabla de proxies edge administrados',
    statements: [
      `CREATE TABLE IF NOT EXISTS edge_proxies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        api_port INTEGER NOT NULL DEFAULT 8090,
        api_key TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    ]
  },
  {
    id: '202608220001_create_hosting_plans_table',
    description: 'Tabla de planes de hosting por defecto',
    statements: [
      `CREATE TABLE IF NOT EXISTS hosting_plans (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(128) NOT NULL,
        price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        paypal_plan_id VARCHAR(128) DEFAULT '',
        features JSONB DEFAULT '{}',
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`
    ]
  },
  {
    id: '202608220002_create_server_cron_jobs_table',
    description: 'Tabla de tareas programadas por servidor (server_cron_jobs)',
    statements: [
      `CREATE TABLE IF NOT EXISTS server_cron_jobs (
        id SERIAL PRIMARY KEY,
        server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        time_hh_mm TEXT NOT NULL,
        action TEXT NOT NULL,
        payload TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'CREATE INDEX IF NOT EXISTS idx_server_cron_jobs_server_id ON server_cron_jobs(server_id)'
    ]
  },
  {
    id: '202608220003_audit_logs_user_agent_column',
    description: 'Añadir columna user_agent a la tabla audit_logs',
    statements: [
      'ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT'
    ]
  },
  {
    id: '202608220004_hosting_plans_is_active_column',
    description: 'Añadir columna is_active a la tabla hosting_plans',
    statements: [
      'ALTER TABLE hosting_plans ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true'
    ]
  },
  {
    id: '202608240001_server_resource_allocation_and_node_ports',
    description: 'Persistir RAM asignada y permitir reutilizar puertos de forma segura entre nodos',
    statements: [
      'ALTER TABLE servers ADD COLUMN IF NOT EXISTS allocated_ram_gb INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE servers DROP CONSTRAINT IF EXISTS servers_fivem_port_key',
      'ALTER TABLE servers DROP CONSTRAINT IF EXISTS servers_txadmin_port_key',
      'ALTER TABLE servers DROP CONSTRAINT IF EXISTS servers_blender_port_key',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_servers_node_fivem_port ON servers (COALESCE(node_id, 0), fivem_port)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_servers_node_txadmin_port ON servers (COALESCE(node_id, 0), txadmin_port)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_servers_node_blender_port ON servers (COALESCE(node_id, 0), blender_port) WHERE blender_port IS NOT NULL',
      'ALTER TABLE servers DROP CONSTRAINT IF EXISTS servers_allocated_ram_gb_positive',
      'ALTER TABLE servers ADD CONSTRAINT servers_allocated_ram_gb_positive CHECK (allocated_ram_gb >= 0)'
    ]
  },
  {
    id: '202609120001_server_stats_history',
    description: 'Historial de métricas por servidor utilizado por el panel de clientes',
    statements: [
      `CREATE TABLE IF NOT EXISTS server_stats_history (
        id BIGSERIAL PRIMARY KEY,
        server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        cpu REAL NOT NULL,
        ram REAL NOT NULL,
        ram_gb REAL NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'CREATE INDEX IF NOT EXISTS idx_server_stats_history_server_time ON server_stats_history(server_id, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_server_stats_history_created_at ON server_stats_history(created_at)'
    ]
  },
  {
    id: '202609120002_notifications',
    description: 'Persistencia versionada de notificaciones administrativas y de clientes',
    statements: [
      `CREATE TABLE IF NOT EXISTS notifications (
        id BIGSERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        type VARCHAR(32) NOT NULL DEFAULT 'info',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC)'
    ]
  },
  {
    id: '202609160001_deployment_jobs',
    description: 'Cola durable e idempotente para despliegues de servidores',
    statements: [
      `CREATE TABLE IF NOT EXISTS deployment_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        server_id UUID REFERENCES servers(id) ON DELETE SET NULL,
        idempotency_key TEXT NOT NULL,
        payload JSONB NOT NULL,
        secret_ciphertext TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        claimed_at TIMESTAMPTZ,
        claimed_by TEXT,
        completed_at TIMESTAMPTZ,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT deployment_jobs_status_valid
          CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
        CONSTRAINT deployment_jobs_attempts_valid
          CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 20),
        UNIQUE(owner_id, idempotency_key)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_deployment_jobs_claim
       ON deployment_jobs(status, available_at, created_at)
       WHERE status = 'queued'`,
      `CREATE INDEX IF NOT EXISTS idx_deployment_jobs_owner_created
       ON deployment_jobs(owner_id, created_at DESC)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_deployment_jobs_one_active_per_owner
       ON deployment_jobs(owner_id)
       WHERE status IN ('queued', 'running')`
    ]
  }
];

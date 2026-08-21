/**
 * 🗄️ RageNodes Versioned Database Migrations System
 * 
 * Reglas para desarrolladores:
 * 1. Cada migración debe tener un `id` con timestamp UTC (ej. YYYYMMDDHHMM_nombre_descriptivo).
 * 2. Las sentencias deben ser idempotentes (usar IF NOT EXISTS / ON CONFLICT).
 * 3. Nunca modificar una migración que ya fue aplicada en producción. Agregar una nueva migración al final.
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
        mc_version TEXT NOT NULL DEFAULT 'LATEST',
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

      `CREATE TABLE IF NOT EXISTS server_subusers (
        id SERIAL PRIMARY KEY,
        server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        permissions JSONB NOT NULL DEFAULT '["restart", "console"]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(server_id, user_id)
      )`,

      `CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'info',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS backups (
        id SERIAL PRIMARY KEY,
        server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        size_bytes BIGINT DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS bot_knowledge (
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
      )`,

      `CREATE TABLE IF NOT EXISTS bot_ticket_logs (
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
      )`,

      `CREATE TABLE IF NOT EXISTS bot_stats (
        id BIGSERIAL PRIMARY KEY,
        intencion TEXT NOT NULL DEFAULT 'desconocida',
        resuelto BOOLEAN NOT NULL DEFAULT false,
        escalado BOOLEAN NOT NULL DEFAULT false,
        patron_id INTEGER REFERENCES bot_knowledge(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS server_stats_history (
        id BIGSERIAL PRIMARY KEY,
        server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
        cpu FLOAT NOT NULL,
        ram FLOAT NOT NULL,
        ram_gb FLOAT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS marketplace_scripts (
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
      )`,

      `CREATE TABLE IF NOT EXISTS marketplace_licenses (
        id SERIAL PRIMARY KEY,
        script_id INTEGER REFERENCES marketplace_scripts(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        license_key TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS vendor_applications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        discord_username TEXT NOT NULL,
        portfolio_url TEXT,
        experience_summary TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        admin_notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS hosting_plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        paypal_plan_id TEXT,
        image_url TEXT,
        features JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_active BOOLEAN DEFAULT true,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS server_cron_jobs (
        id SERIAL PRIMARY KEY,
        server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
        time_hh_mm TEXT NOT NULL,
        action TEXT NOT NULL,
        payload TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      // Indices estructurales base
      'CREATE INDEX IF NOT EXISTS idx_servers_owner_id ON servers(owner_id)',
      'CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id)',
      'CREATE INDEX IF NOT EXISTS idx_stats_history_server_created ON server_stats_history(server_id, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON audit_logs(user_id, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_backups_server_id ON backups(server_id)',
      'CREATE INDEX IF NOT EXISTS idx_server_subusers_user_id ON server_subusers(user_id)'
    ]
  },
  {
    id: '202605170001_user_session_columns',
    statements: [
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id TEXT UNIQUE',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 1'
    ]
  },
  {
    id: '202605170002_server_blender_columns',
    statements: [
      'ALTER TABLE servers ADD COLUMN IF NOT EXISTS blender_port INTEGER UNIQUE',
      'ALTER TABLE servers ADD COLUMN IF NOT EXISTS blender_pass TEXT'
    ]
  },
  {
    id: '202605170003_plan_and_marketplace_images',
    statements: [
      'ALTER TABLE hosting_plans ADD COLUMN IF NOT EXISTS image_url TEXT',
      'ALTER TABLE marketplace_scripts ADD COLUMN IF NOT EXISTS image_url TEXT'
    ]
  },
  {
    id: '202605170004_disk_plan_images_if_table_exists',
    optional: true,
    statements: [
      `DO $$
      BEGIN
        IF to_regclass('public.disk_plans') IS NOT NULL THEN
          ALTER TABLE disk_plans ADD COLUMN IF NOT EXISTS image_url TEXT;
        END IF;
      END $$;`
    ]
  },
  {
    id: '202605170005_server_node_reference',
    statements: [
      'ALTER TABLE servers ADD COLUMN IF NOT EXISTS node_id INTEGER DEFAULT 0 REFERENCES nodes(id) ON DELETE SET NULL'
    ]
  },
  {
    id: '202605190001_server_allocated_ram_gb',
    statements: [
      'ALTER TABLE servers ADD COLUMN IF NOT EXISTS allocated_ram_gb INTEGER DEFAULT 0'
    ]
  },
  {
    id: '202605240001_download_jobs',
    statements: [
      `CREATE TABLE IF NOT EXISTS download_jobs (
        id TEXT PRIMARY KEY,
        server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        url TEXT NOT NULL,
        target_path TEXT NOT NULL DEFAULT '/',
        file_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        status_message TEXT NOT NULL DEFAULT 'En cola...',
        progress INTEGER NOT NULL DEFAULT 0,
        bytes_downloaded BIGINT NOT NULL DEFAULT 0,
        bytes_total BIGINT NOT NULL DEFAULT 0,
        is_error BOOLEAN NOT NULL DEFAULT false,
        is_finished BOOLEAN NOT NULL DEFAULT false,
        error_message TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'CREATE INDEX IF NOT EXISTS idx_download_jobs_server_created ON download_jobs(server_id, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_download_jobs_status_created ON download_jobs(status, created_at ASC)'
    ]
  },
  {
    id: '202605250001_legal_agreements_invoices',
    statements: [
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS paypal_sub_id TEXT',
      'ALTER TABLE payments ADD COLUMN IF NOT EXISTS paypal_subscription_id TEXT',
      'ALTER TABLE payments ADD COLUMN IF NOT EXISTS agreement_id UUID',
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD'`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '{}'::jsonb`,
      `CREATE TABLE IF NOT EXISTS legal_documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type TEXT NOT NULL,
        version TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(type, version)
      )`,
      `INSERT INTO legal_documents (type, version, title, url, content_hash, is_active, published_at)
       VALUES
        ('terms', '2026-03', 'Terminos y Condiciones de Servicio', '/terminos.html', encode(digest('terms:/terminos.html:2026-03', 'sha256'), 'hex'), true, NOW()),
        ('privacy', '2026-03', 'Politica de Privacidad', '/privacidad.html', encode(digest('privacy:/privacidad.html:2026-03', 'sha256'), 'hex'), true, NOW()),
        ('refund', '2026-03', 'Politica de Reembolsos y Provision Digital', '/terminos.html#reembolsos', encode(digest('refund:/terminos.html#reembolsos:2026-03', 'sha256'), 'hex'), true, NOW())
       ON CONFLICT (type, version) DO NOTHING`,
      `CREATE TABLE IF NOT EXISTS user_agreements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        token TEXT NOT NULL UNIQUE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        username TEXT,
        email TEXT,
        plan_id TEXT NOT NULL,
        plan_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        document_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
        accepted_terms BOOLEAN NOT NULL DEFAULT false,
        accepted_privacy BOOLEAN NOT NULL DEFAULT false,
        accepted_refund BOOLEAN NOT NULL DEFAULT false,
        accepted_immediate_provision BOOLEAN NOT NULL DEFAULT false,
        accepted_renewal BOOLEAN NOT NULL DEFAULT false,
        ip_address TEXT,
        user_agent TEXT,
        paypal_subscription_id TEXT,
        consumed_at TIMESTAMPTZ,
        accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '2 hours'
      )`,
      `CREATE TABLE IF NOT EXISTS invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_number TEXT NOT NULL UNIQUE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
        agreement_id UUID REFERENCES user_agreements(id) ON DELETE SET NULL,
        paypal_subscription_id TEXT,
        status TEXT NOT NULL DEFAULT 'paid',
        currency TEXT NOT NULL DEFAULT 'USD',
        subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
        tax DECIMAL(10,2) NOT NULL DEFAULT 0,
        total DECIMAL(10,2) NOT NULL DEFAULT 0,
        plan_id TEXT,
        plan_name TEXT,
        customer_email TEXT,
        customer_username TEXT,
        evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
        issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'CREATE INDEX IF NOT EXISTS idx_user_agreements_email_created ON user_agreements(email, accepted_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_user_agreements_token ON user_agreements(token)',
      'CREATE INDEX IF NOT EXISTS idx_invoices_user_created ON invoices(user_id, issued_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_invoices_paypal_sub ON invoices(paypal_subscription_id)',
      'CREATE INDEX IF NOT EXISTS idx_payments_paypal_sub ON payments(paypal_subscription_id)'
    ]
  },
  {
    id: '202608160001_payment_entitlement_hardening',
    statements: [
      'ALTER TABLE marketplace_licenses ADD COLUMN IF NOT EXISTS paypal_order_id TEXT',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_licenses_paypal_order ON marketplace_licenses(paypal_order_id) WHERE paypal_order_id IS NOT NULL',
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
      "ALTER TABLE servers ADD COLUMN IF NOT EXISTS mc_version TEXT NOT NULL DEFAULT 'LATEST'",
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
  }
];

export async function runMigrations(query, withTransaction) {
  // 1. Asegurar tabla de control de versiones
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  let appliedCount = 0;

  // 2. Ejecutar cada migración dentro de una transacción atómica protegida
  for (const migration of migrations) {
    const existing = await query('SELECT id FROM schema_migrations WHERE id = $1', [migration.id]);
    if (existing.rowCount > 0) continue;

    console.log(`[DB Migration] 🚀 Aplicando migración: ${migration.id}...`);
    try {
      await withTransaction(async (tx) => {
        for (const statement of migration.statements) {
          await tx(statement);
        }
        await tx('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
      });
      appliedCount++;
      console.log(`[DB Migration] ✅ Migración ${migration.id} aplicada con éxito.`);
    } catch (error) {
      if (migration.optional) {
        console.warn(`[DB Migration] ⚠️ Migración opcional ${migration.id} omitida: ${error.message}`);
        await query('INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING', [migration.id]);
        continue;
      }
      console.error(`[DB Migration] ❌ Error fatal en migración ${migration.id}:`, error.message);
      throw error;
    }
  }

  if (appliedCount === 0) {
    console.log(`[DB Migration] ✨ Base de datos al día. No hay migraciones pendientes.`);
  } else {
    console.log(`[DB Migration] 🎉 Se aplicaron ${appliedCount} migraciones con éxito.`);
  }
  return appliedCount;
}

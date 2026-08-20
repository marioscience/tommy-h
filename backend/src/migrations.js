import { query } from './db.js';

const migrations = [
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
  }
];

export async function runMigrations() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  for (const migration of migrations) {
    const existing = await query('SELECT id FROM schema_migrations WHERE id = $1', [migration.id]);
    if (existing.rowCount > 0) continue;

    console.log(`[DB] Aplicando migracion ${migration.id}...`);
    try {
      await query('BEGIN');
      for (const statement of migration.statements) {
        await query(statement);
      }
      await query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
      await query('COMMIT');
      console.log(`[DB] Migracion ${migration.id} aplicada.`);
    } catch (error) {
      await query('ROLLBACK').catch(() => {});
      if (migration.optional) {
        console.warn(`[DB] Migracion opcional ${migration.id} omitida: ${error.message}`);
        await query('INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING', [migration.id]);
        continue;
      }
      throw error;
    }
  }
}
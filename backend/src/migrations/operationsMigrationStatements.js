export const operationsMigrations = [
  {
    id: '202609160001_durable_backup_and_cron_jobs',
    description: 'Colas persistentes para backups y ejecuciones cron idempotentes',
    statements: [
      `CREATE TABLE IF NOT EXISTS backup_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        requester_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        requested_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
        custom_name TEXT,
        plan TEXT NOT NULL DEFAULT 'hobby',
        priority INTEGER NOT NULL DEFAULT 10,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        claimed_at TIMESTAMPTZ,
        claimed_by TEXT,
        completed_at TIMESTAMPTZ,
        result JSONB,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT backup_jobs_status_valid
          CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        CONSTRAINT backup_jobs_attempts_valid
          CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 20)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_backup_jobs_claim
       ON backup_jobs(status, available_at, priority DESC, created_at)
       WHERE status = 'queued'`,
      `CREATE INDEX IF NOT EXISTS idx_backup_jobs_requester_created
       ON backup_jobs(requester_id, created_at DESC)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_backup_jobs_one_active_per_server
       ON backup_jobs(server_id) WHERE status IN ('queued', 'running')`,
      `ALTER TABLE server_cron_jobs ADD COLUMN IF NOT EXISTS last_run_key TEXT`,
      `ALTER TABLE server_cron_jobs ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ`
    ]
  },
  {
    id: '202609160002_repair_durable_worker_schema',
    description: 'Repara instalaciones heredadas antes de iniciar los workers durables',
    statements: [
      `CREATE TABLE IF NOT EXISTS backup_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        requester_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        requested_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
        custom_name TEXT,
        plan TEXT NOT NULL DEFAULT 'hobby',
        priority INTEGER NOT NULL DEFAULT 10,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        claimed_at TIMESTAMPTZ,
        claimed_by TEXT,
        completed_at TIMESTAMPTZ,
        result JSONB,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT backup_jobs_status_valid
          CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        CONSTRAINT backup_jobs_attempts_valid
          CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 20)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_backup_jobs_claim
       ON backup_jobs(status, available_at, priority DESC, created_at)
       WHERE status = 'queued'`,
      `CREATE INDEX IF NOT EXISTS idx_backup_jobs_requester_created
       ON backup_jobs(requester_id, created_at DESC)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_backup_jobs_one_active_per_server
       ON backup_jobs(server_id) WHERE status IN ('queued', 'running')`,
      `ALTER TABLE server_cron_jobs
       ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`,
      `ALTER TABLE server_cron_jobs ADD COLUMN IF NOT EXISTS last_run_key TEXT`,
      `ALTER TABLE server_cron_jobs ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ`
    ]
  },
  {
    id: '202609160003_notification_audience',
    description: 'Separa notificaciones administrativas de los avisos para clientes',
    statements: [
      `ALTER TABLE notifications
       ADD COLUMN IF NOT EXISTS audience VARCHAR(16) NOT NULL DEFAULT 'client'`,
      `UPDATE notifications
       SET audience = 'admin'
       WHERE title LIKE '%[Seguridad]%'
          OR title LIKE '%[Staging]%'
          OR title LIKE '%[ROLLBACK%'
          OR title LIKE '%Despliegue%'
          OR title LIKE '%[Deploy%'`,
      `CREATE INDEX IF NOT EXISTS idx_notifications_audience_created_at
       ON notifications(audience, created_at DESC)`
    ]
  }
];

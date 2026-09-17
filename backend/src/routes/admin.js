import adminNodesRouter from './adminNodes.js';
import adminHealthRouter from './adminHealth.js';
import adminUsersRouter from './adminUsers.js';
import adminDisputesRouter from './adminDisputes.js';
import adminVendorsRouter from './adminVendors.js';
import express from 'express';
import { query, logAudit } from '../db.js';
import { requireAuth, requireAdmin, signToken } from '../middleware/auth.js';
import { controlServer } from '../services/serverControlService.js';
import { deleteServer } from '../services/serverDeletionService.js';

// 🚀 SERVICIOS DE BACKUP
import { listServerBackups } from '../services/backupService.js';
import { restoreBackup } from '../services/backupRestoreService.js';
import { migrateResources } from '../services/serverResourceMigrationService.js';
import { backupQueue } from '../services/backupQueue.js';
import { getServerByIdForUser } from '../services/serverService.js';
import { findUsernameById } from '../repositories/userRepository.js';
import { getDeploymentQueueMetrics } from '../repositories/deploymentJobRepository.js';
import { registerCatalogRoutes } from './admin/catalogRoutes.js';
import { registerObservabilityRoutes } from './admin/observabilityRoutes.js';

const router = express.Router();

// Protegemos todas las rutas con autenticación y rol admin
router.use(requireAuth, requireAdmin);
router.use(adminNodesRouter);
router.use(adminHealthRouter);
router.use(adminUsersRouter);
router.use('/disputes', adminDisputesRouter);
router.use(adminVendorsRouter);

router.get('/oxide-status', async (req, res) => {
    const freshToken = signToken(req.user);
    let available = false;
    const endpoints = ['http://oxide_control_panel:3000/healthz', 'http://127.0.0.1:3000/healthz', 'http://localhost:3000/healthz'];
    for (const ep of endpoints) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 800);
            const response = await fetch(ep, { signal: controller.signal });
            clearTimeout(timeout);
            if (response.ok) { available = true; break; }
        } catch {}
    }
    return res.json({ available, active: available, token: freshToken });
});

router.get('/backup-jobs/:jobId', async (req, res) => {
    const job = await backupQueue.getJob(req.params.jobId, req.user.sub, true);
    if (!job) return res.status(404).json({ error: 'Job no encontrado' });
    res.json(job);
});

router.get('/deployment-queue/metrics', async (_req, res) => {
    try {
        res.json({ items: await getDeploymentQueueMetrics() });
    } catch (error) {
        res.status(500).json({ error: error.message || 'No se pudieron cargar las métricas.' });
    }
});

router.get('/overview', async (_req, res) => {
  const [users, servers, audits, nodes] = await Promise.all([
    query('SELECT COUNT(*)::int AS total FROM users'),
    query('SELECT COUNT(*)::int AS total FROM servers'),
    query('SELECT COUNT(*)::int AS total FROM audit_logs'),
    query('SELECT COUNT(*)::int AS total FROM nodes')
  ]);
  res.json({ totals: { users: users.rows[0].total, servers: servers.rows[0].total, auditLogs: audits.rows[0].total, nodes: nodes.rows[0].total } });
});

// ==========================================
// 📡 GESTIÓN DE NODOS (Multi-Nodo)
// ==========================================




router.get('/servers', async (_req, res) => {
  import('../services/serverService.js').then(async ({ getServersForUser }) => {
     try {
         const servers = await getServersForUser(0, true);
         for (let s of servers) {
            s.username = await findUsernameById(s.owner_id) || 'Desconocido';
         }
         res.json({ items: servers });
     } catch (e) {
         res.status(500).json({ error: e.message });
     }
  });
});

router.put('/servers/:id', async (req, res) => {
  const { name, plan } = req.body;
  try {
      if (name) await query('UPDATE servers SET name = $1 WHERE id = $2', [name, req.params.id]);
      if (plan) await query('UPDATE servers SET runtime_plan = $1 WHERE id = $2', [plan, req.params.id]);
      res.json({ success: true });
  } catch (e) {
      res.status(500).json({ error: "Error al editar el servidor" });
  }
});

router.delete('/servers/:id', async (req, res) => {
  try { await deleteServer(req.params.id, null, true); res.json({ success: true }); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

// ==========================================
// 🚀 RUTAS DE DISASTER RECOVERY & BACKUPS
// ¡OJO! Estas DEBEN ir antes de /:action
// ==========================================

// Listar los backups de un servidor
router.get('/servers/:id/backups', async (req, res) => {
    try {
        const items = await listServerBackups(req.params.id, null, true);
        res.json({ items });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Restaurar un backup
router.post('/servers/:id/backups/restore', async (req, res) => {
    try {
        const result = await restoreBackup(req.params.id, req.body.filename, null, true);
        await logAudit(req, 'admin.server.restore_backup', { serverId: req.params.id, backup: req.body.filename });
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Forzar Backup Manual desde el Panel Admin (Con Cola de Prioridad)
router.post('/servers/:id/backup', async (req, res) => {
    try {
        const s = await getServerByIdForUser(req.params.id, null, true);
        if (!s) return res.status(404).json({ error: "Servidor no encontrado" });

        const job = await backupQueue.enqueue(
            req.params.id,
            req.user.sub,
            true,
            'admin_forced',
            'partner'
        );

        await logAudit(req, 'admin.server.force_backup.enqueue', { serverId: req.params.id, jobId: job.jobId });
        res.status(202).json({ ...job, queued: true, statusUrl: `/api/admin/backup-jobs/${job.jobId}` });
    } catch (e) {
        console.error("Error en backup manual admin:", e);
        res.status(500).json({ error: e.message });
    }
});

// Migrar recursos a otro servidor
router.post('/servers/:id/migrate', async (req, res) => {
    try {
        const result = await migrateResources(req.params.id, req.body.targetServerId, true);
        await logAudit(req, 'admin.server.migrate', { oldServer: req.params.id, newServer: req.body.targetServerId });
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// ==========================================
// 🛑 RUTAS GENÉRICAS (SIEMPRE AL FINAL)
// ==========================================

// Terminal Web (Ejecutar comandos dentro del contenedor)
router.post('/servers/:id/exec', async (req, res) => {
    try {
        const { command, cwd } = req.body;
        if (!command) return res.status(400).json({ error: "Falta el comando" });

        // Obtener el nombre del contenedor
        const srv = await query('SELECT container_name FROM servers WHERE id = $1', [req.params.id]);
        if (!srv.rowCount) return res.status(404).json({ error: "Servidor no encontrado" });
        const containerName = srv.rows[0].container_name;

        import('../services/dockerService.js').then(async ({ executeCommandInContainer }) => {
            try {
                const result = await executeCommandInContainer(containerName, command, cwd || '/');
                await logAudit(req, 'admin.server.exec', { serverId: req.params.id, command, cwd });
                res.json({ stdout: result.stdout || '', stderr: result.stderr || '', cwd: result.cwd, error: null });
            } catch (error) {
                res.json({ stdout: '', stderr: '', error: error.message });
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/servers/:id/:action', async (req, res) => {
  try { res.json({ item: await controlServer(req.params.id, null, req.params.action, true) }); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

registerCatalogRoutes(router);

registerObservabilityRoutes(router);

export default router;

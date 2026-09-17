import adminNodesRouter from './adminNodes.js';
import adminHealthRouter from './adminHealth.js';
import adminUsersRouter from './adminUsers.js';
import adminDisputesRouter from './adminDisputes.js';
import adminVendorsRouter from './adminVendors.js';
import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import si from 'systeminformation';
import { config } from '../config.js';
import { query, logAudit } from '../db.js';
import { requireAuth, requireAdmin, signToken, setSessionCookie } from '../middleware/auth.js';
import { controlServer } from '../services/serverControlService.js';
import { deleteServer } from '../services/serverDeletionService.js';
import { getNodeConnection } from '../services/dockerService.js';
import { buildEvidenceBundle, buildEvidenceZip } from '../services/billingEvidenceService.js';
import { testNodeConnection } from '../utils/dockerNode.js';

// 🚀 SERVICIOS DE BACKUP
import { listServerBackups, migrateResources } from '../services/backupService.js';
import { restoreBackup } from '../services/backupRestoreService.js';
import { backupQueue } from '../services/backupQueue.js';
import { getServerByIdForUser } from '../services/serverService.js';
import { createNotification, deleteNotification, listAdminNotifications } from '../repositories/notificationRepository.js';
import { findUsernameById } from '../repositories/userRepository.js';
import { getDeploymentQueueMetrics } from '../repositories/deploymentJobRepository.js';

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

router.get('/hosting-plans', async (_req, res) => {
    try {
        const result = await query(`
            SELECT
                hp.*,
                COALESCE(u.user_count, 0)::int AS user_count,
                COALESCE(s.server_count, 0)::int AS server_count,
                CASE
                    WHEN hp.id IN ('community_starter','community_pro','community_network') THEN 'community'
                    WHEN hp.id IN ('hobby','standard','premium','platinum') THEN 'main'
                    WHEN hp.id LIKE 'game_%' THEN 'dedicated'
                    ELSE 'legacy'
                END AS plan_group
            FROM hosting_plans hp
            LEFT JOIN (
                SELECT plan, COUNT(*) AS user_count
                FROM users
                GROUP BY plan
            ) u ON u.plan = hp.id
            LEFT JOIN (
                SELECT runtime_plan, COUNT(*) AS server_count
                FROM servers
                GROUP BY runtime_plan
            ) s ON s.runtime_plan = hp.id
            ORDER BY
                CASE
                    WHEN hp.id LIKE 'community_%' THEN 5
                    WHEN hp.id = 'hobby' THEN 10
                    WHEN hp.id = 'standard' THEN 20
                    WHEN hp.id = 'premium' THEN 30
                    WHEN hp.id = 'platinum' THEN 40
                    WHEN hp.id LIKE 'game_%' THEN 100
                    ELSE 900
                END,
                hp.price ASC,
                hp.id ASC
        `);
        res.json({ items: result.rows });
    } catch (e) {
        res.status(500).json({ error: 'Error al obtener planes' });
    }
});

router.post('/hosting-plans', async (req, res) => {
    const { id, name, price, features, image_url } = req.body;
    if (!id || !name || !price) return res.status(400).json({ error: 'Faltan campos requeridos' });
    try {
        const featuresJson = typeof features === 'string' ? features : JSON.stringify(features || {});
        await query(
            'INSERT INTO hosting_plans (id, name, price, features, image_url) VALUES ($1, $2, $3, $4, $5)',
            [id, name, price, featuresJson, image_url]
        );
        await logAudit(req, 'admin.hosting_plan.create', { id, name, price });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/hosting-plans/:id', async (req, res) => {
    const { name, price, paypal_plan_id, features, is_active, image_url } = req.body;
    const planId = req.params.id;
    try {
        if (name) await query('UPDATE hosting_plans SET name = $1 WHERE id = $2', [name, planId]);
        if (price !== undefined) await query('UPDATE hosting_plans SET price = $1 WHERE id = $2', [price, planId]);
        if (paypal_plan_id) await query('UPDATE hosting_plans SET paypal_plan_id = $1 WHERE id = $2', [paypal_plan_id, planId]);
        if (features) await query('UPDATE hosting_plans SET features = $1 WHERE id = $2', [JSON.stringify(features), planId]);
        if (is_active !== undefined) await query('UPDATE hosting_plans SET is_active = $1 WHERE id = $2', [is_active, planId]);
        if (image_url !== undefined) await query('UPDATE hosting_plans SET image_url = $1 WHERE id = $2', [image_url, planId]);
        await query('UPDATE hosting_plans SET updated_at = NOW() WHERE id = $1', [planId]);
        await logAudit(req, 'admin.plan.update', { planId, name, price });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Error al actualizar el plan' });
    }
});

// RUTAS EXTRA PARA NOTIFICACIONES Y AUDITORÍA
router.get('/notifications', async (_req, res) => {
  res.json({ items: await listAdminNotifications() });
});

router.post('/notifications', async (req, res) => {
  const { title, content, type, audience } = req.body;
  await createNotification({ title, content, type: type || 'info', audience: audience || 'client' });
  res.json({ success: true });
});

router.delete('/notifications/:id', async (req, res) => {
  await deleteNotification(req.params.id);
  res.json({ success: true });
});

router.get('/audit-logs', async (_req, res) => {
  const result = await query(`
    SELECT a.id, a.user_id, a.action, a.details, a.ip_address, a.user_agent, a.created_at, u.username
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC
    LIMIT 500
  `);
  res.json({ items: result.rows });
});

router.delete('/audit-logs', async (req, res) => {
  await query('DELETE FROM audit_logs');
  await logAudit(req, 'admin.audit.clear_all');
  res.json({ success: true });
});

router.get('/audit-logs/export', async (req, res) => {
  const result = await query(`
    SELECT a.created_at, u.username, a.action, a.ip_address, a.details
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC
  `);

  let csv = 'Fecha,Usuario,Accion,IP,Detalles\n';
  result.rows.forEach(r => {
    const details = JSON.stringify(r.details).replace(/"/g, '""');
    csv += `"${r.created_at.toISOString()}","${r.username || 'Sistema'}","${r.action}","${r.ip_address || ''}","${details}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=auditoria_ragenodes.csv');
  res.send(csv);
});

/**
 * 💾 GESTIÓN DE EXPANSIONES DE DISCO
 */
router.get('/disk-plans', async (req, res) => {
    const result = await query('SELECT * FROM disk_plans ORDER BY gb_amount ASC');
    res.json({ items: result.rows });
});

router.post('/disk-plans', async (req, res) => {
    const { id, name, price, gb_amount, image_url } = req.body;
    if (!id || !name || !price || !gb_amount) return res.status(400).json({ error: 'Faltan campos requeridos' });
    try {
        await query(
            'INSERT INTO disk_plans (id, name, price, gb_amount, image_url) VALUES ($1, $2, $3, $4, $5)',
            [id, name, price, gb_amount, image_url]
        );
        await logAudit(req, 'admin.disk_plan.create', { id, name, price, gb_amount });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/disk-plans/:id', async (req, res) => {
    const { price, paypal_plan_id, is_active, image_url } = req.body;
    await query(
        'UPDATE disk_plans SET price = $1, paypal_plan_id = $2, is_active = $3, image_url = $4, updated_at = NOW() WHERE id = $5',
        [price, paypal_plan_id, is_active, image_url, req.params.id]
    );
    await logAudit(req, 'admin.disk_plan.update', { id: req.params.id, price, paypal_plan_id });
    res.json({ success: true });
});

/**
 * 🛍️ GESTIÓN DE MARKETPLACE
 */
router.put('/marketplace/scripts/:id', async (req, res) => {
    const { name, description, price, is_active, image_url } = req.body;
    try {
        await query(
            'UPDATE marketplace_scripts SET name = $1, description = $2, price = $3, is_active = $4, image_url = $5 WHERE id = $6',
            [name, description, price, is_active, image_url, req.params.id]
        );
        await logAudit(req, 'admin.marketplace.update', { script_id: req.params.id, name, price });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * 🔄 SINCRONIZACIÓN AUTOMÁTICA CON PAYPAL API
 */
router.post('/paypal/sync-plans', async (req, res) => {
    try {
        import('../services/paypalService.js').then(async ({ createProduct, createBillingPlan }) => {
            let synced = 0;

            // 1. Sincronizar Planes de Hosting
            const hostingPlans = await query('SELECT * FROM hosting_plans WHERE paypal_plan_id IS NULL OR paypal_plan_id = \'\'');
            for (let p of hostingPlans.rows) {
                const prod = await createProduct(`HOST_${p.id}`, `RageNodes Hosting: ${p.name}`, `Suscripción al plan de servidor ${p.name}`, p.image_url);
                const plan = await createBillingPlan(prod.id, p.name, p.price);
                await query('UPDATE hosting_plans SET paypal_plan_id = $1 WHERE id = $2', [plan.id, p.id]);
                synced++;
            }

            // 2. Sincronizar Planes de Expansión de Disco
            const diskPlans = await query('SELECT * FROM disk_plans WHERE paypal_plan_id IS NULL OR paypal_plan_id = \'\'');
            for (let d of diskPlans.rows) {
                const prod = await createProduct(`DISK_${d.id}`, `Expansión de Disco: ${d.gb_amount}GB`, `Ampliación de espacio extra global ${d.gb_amount}GB`, d.image_url);
                const plan = await createBillingPlan(prod.id, `Expansión ${d.gb_amount}GB`, d.price);
                await query('UPDATE disk_plans SET paypal_plan_id = $1 WHERE id = $2', [plan.id, d.id]);
                synced++;
            }

            await logAudit(req, 'admin.paypal.sync_plans', { synced_count: synced });
            res.json({ success: true, message: `Sincronización completa. Se crearon ${synced} nuevos planes en PayPal.` });
        }).catch(err => {
            console.error(err);
            res.status(500).json({ error: 'Error cargando paypalService' });
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;

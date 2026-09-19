import adminNodesRouter from './adminNodes.js';
import adminHealthRouter from './adminHealth.js';
import adminUsersRouter from './adminUsers.js';
import adminDisputesRouter from './adminDisputes.js';
import adminVendorsRouter from './adminVendors.js';
import express from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin, signToken } from '../middleware/auth.js';

// 🚀 SERVICIOS DE BACKUP
import { backupQueue } from '../services/backupQueue.js';
import { getDeploymentQueueMetrics } from '../repositories/deploymentJobRepository.js';
import { registerCatalogRoutes } from './admin/catalogRoutes.js';
import { registerObservabilityRoutes } from './admin/observabilityRoutes.js';
import { registerServerRoutes } from './admin/serverRoutes.js';

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




registerServerRoutes(router);

registerCatalogRoutes(router);

registerObservabilityRoutes(router);

export default router;

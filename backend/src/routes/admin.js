import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import si from 'systeminformation';
import { config } from '../config.js';
import { query, logAudit } from '../db.js';
import { requireAuth, requireAdmin, signToken, setSessionCookie } from '../middleware/auth.js';
import { controlServer, deleteServer } from '../services/serverService.js';
import { getNodeConnection } from '../services/dockerService.js';
import { buildEvidenceBundle, buildEvidenceZip } from '../services/billingEvidenceService.js';
import { testNodeConnection } from '../utils/dockerNode.js';

// 🚀 SERVICIOS DE BACKUP
import { listServerBackups, restoreBackup, migrateResources } from '../services/backupService.js';
import { backupQueue } from '../services/backupQueue.js';
import { getServerByIdForUser } from '../services/serverService.js';

const router = express.Router();

// Protegemos todas las rutas con autenticación y rol admin
router.use(requireAuth, requireAdmin);

router.get('/oxide-status', async (req, res) => {
    const freshToken = signToken(req.user);
    let available = false;
    const endpoints = ['http://oxide_control_panel:3000/healthz', 'http://127.0.0.1:3000/healthz'];
    for (const ep of endpoints) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 800);
            const response = await fetch(ep, { signal: controller.signal });
            clearTimeout(timeout);
            if (response.ok) { available = true; break; }
        } catch {}
    }
    return res.json({ available, token: freshToken });
});

router.get('/backup-jobs/:jobId', async (req, res) => {
    const job = backupQueue.getJob(req.params.jobId, req.user.sub, true);
    if (!job) return res.status(404).json({ error: 'Job no encontrado' });
    res.json(job);
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


router.get('/disputes/evidence-summary', async (req, res) => {
    try {
        const filters = {
            userId: req.query.userId ? Number(req.query.userId) : null,
            invoiceId: req.query.invoiceId ? Number(req.query.invoiceId) : null,
            paypalSubscriptionId: req.query.paypalSubscriptionId || req.query.subscriptionId || null,
            email: req.query.email || null
        };
        if (!filters.userId && !filters.invoiceId && !filters.paypalSubscriptionId && !filters.email) {
            return res.status(400).json({ error: 'Indica userId, invoiceId, paypalSubscriptionId o email.' });
        }

        const bundle = await buildEvidenceBundle(filters);
        if (!bundle.user && bundle.invoices.length === 0 && bundle.payments.length === 0 && bundle.agreements.length === 0) {
            return res.status(404).json({ error: 'No hay evidencia para esos filtros.' });
        }

        res.json({
            generatedAt: bundle.generatedAt,
            user: bundle.user ? {
                id: bundle.user.id,
                username: bundle.user.username,
                email: bundle.user.email,
                plan: bundle.user.plan,
                paypal_sub_id: bundle.user.paypal_sub_id,
                created_at: bundle.user.created_at
            } : null,
            counts: {
                invoices: bundle.invoices.length,
                payments: bundle.payments.length,
                agreements: bundle.agreements.length,
                auditLogs: bundle.auditLogs.length,
                servers: bundle.servers.length
            },
            invoices: bundle.invoices.slice(0, 10).map(i => ({
                id: i.id,
                invoice_number: i.invoice_number,
                status: i.status,
                total: i.total,
                currency: i.currency,
                plan_id: i.plan_id,
                plan_name: i.plan_name,
                issued_at: i.issued_at || i.created_at
            })),
            servers: bundle.servers.slice(0, 20).map(s => ({
                id: s.id,
                name: s.name,
                template: s.template,
                status: s.status,
                fivem_port: s.fivem_port,
                created_at: s.created_at
            }))
        });
    } catch (error) {
        console.error('[admin:dispute-evidence-summary]', error);
        res.status(500).json({ error: 'Error obteniendo resumen de evidencia.' });
    }
});

router.get('/disputes/evidence.zip', async (req, res) => {
    try {
        const filters = {
            userId: req.query.userId ? Number(req.query.userId) : null,
            invoiceId: req.query.invoiceId ? Number(req.query.invoiceId) : null,
            paypalSubscriptionId: req.query.paypalSubscriptionId || req.query.subscriptionId || null,
            email: req.query.email || null
        };
        if (!filters.userId && !filters.invoiceId && !filters.paypalSubscriptionId && !filters.email) {
            return res.status(400).json({ error: 'Indica userId, invoiceId, paypalSubscriptionId o email.' });
        }

        const bundle = await buildEvidenceBundle(filters);
        if (!bundle.user && bundle.invoices.length === 0 && bundle.payments.length === 0 && bundle.agreements.length === 0) {
            return res.status(404).json({ error: 'No hay evidencia para esos filtros.' });
        }

        const zip = buildEvidenceZip(bundle);
        const subject = bundle.user?.username || filters.email || filters.paypalSubscriptionId || 'evidence';
        await logAudit(req, 'admin.dispute_evidence.export', {
            filters,
            subject,
            counts: {
                invoices: bundle.invoices.length,
                payments: bundle.payments.length,
                agreements: bundle.agreements.length,
                auditLogs: bundle.auditLogs.length,
                servers: bundle.servers.length
            }
        });
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="ragenodes-evidence-${String(subject).replace(/[^a-z0-9_-]/gi, '_')}.zip"`);
        res.send(zip);
    } catch (error) {
        console.error('[admin:dispute-evidence]', error);
        res.status(500).json({ error: 'Error generando evidencia.' });
    }
});

router.post('/users/:id/reset-password', async (req, res) => {
    const { newPassword } = req.body || {};
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
    }
    try {
        const hash = await bcrypt.hash(newPassword, 12);
        await query('UPDATE users SET password_hash = $1, token_version = COALESCE(token_version, 0) + 1 WHERE id = $2', [hash, req.params.id]);
        await logAudit(req, 'admin.user.reset_password', { targetUserId: req.params.id });
        res.json({ success: true, message: 'Contraseña actualizada correctamente.' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/nodes', async (req, res) => {
    try {
        const result = await query("SELECT * FROM nodes ORDER BY id ASC");
        res.json({ items: result.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/nodes', async (req, res) => {
    const { name, ip_address, api_key } = req.body;
    if (!name || !ip_address || !api_key) return res.status(400).json({ error: "Faltan campos" });
    try {
        await query("INSERT INTO nodes (name, ip_address, api_key) VALUES ($1, $2, $3)", [name, ip_address, api_key]);
        await logAudit(req, 'admin.node.add', { name, ip_address });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/nodes/:id', async (req, res) => {
    const { name, ip_address, api_key, status } = req.body;
    try {
        if (name) await query("UPDATE nodes SET name = $1 WHERE id = $2", [name, req.params.id]);
        if (ip_address) await query("UPDATE nodes SET ip_address = $1 WHERE id = $2", [ip_address, req.params.id]);
        if (api_key) await query("UPDATE nodes SET api_key = $1 WHERE id = $2", [api_key, req.params.id]);
        if (status) await query("UPDATE nodes SET status = $1 WHERE id = $2", [status, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/nodes/:id/test', async (req, res) => {
    try {
        const nodeRes = await query("SELECT id, ip_address FROM nodes WHERE id = $1", [req.params.id]);
        if (nodeRes.rowCount === 0) return res.status(404).json({ error: "Nodo no encontrado" });
        
        const node = nodeRes.rows[0];
        
        // El nodo 0 suele ser localhost, pero si hay testNodeConnection intentará por TLS en 2376
        const testResult = await testNodeConnection(node.id, node.ip_address);
        
        // Actualizar la BBDD con los recursos reales
        await query(
            "UPDATE nodes SET status = 'active', cpu_cores = $1, ram_total_gb = $2 WHERE id = $3", 
            [testResult.cpuCores, testResult.ramTotalGb, node.id]
        );
        
        res.json({ success: true, resources: testResult });
    } catch (e) { 
        await query("UPDATE nodes SET status = 'offline' WHERE id = $1", [req.params.id]);
        res.status(500).json({ error: e.message }); 
    }
});

router.delete('/nodes/:id', async (req, res) => {
    if (req.params.id === '0') return res.status(400).json({ error: "No se puede eliminar el Nodo Maestro" });
    try {
        await query("DELETE FROM nodes WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 🛡️ GESTIÓN DE EDGE PROXIES
// ==========================================

router.get('/proxies', async (req, res) => {
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS edge_proxies (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                ip_address TEXT NOT NULL,
                api_port INTEGER NOT NULL DEFAULT 8090,
                api_key TEXT NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT false,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        const result = await query("SELECT * FROM edge_proxies ORDER BY id ASC");
        res.json({ items: result.rows, proxies: result.rows });
    } catch (e) {
        console.error("Error al obtener edge_proxies:", e);
        res.json({ items: [], proxies: [] });
    }
});

router.post('/proxies', async (req, res) => {
    const { name, ip_address, api_port, api_key } = req.body;
    if (!name || !ip_address || !api_key) return res.status(400).json({ error: "Faltan campos" });
    try {
        const port = api_port || 8090;
        await query("INSERT INTO edge_proxies (name, ip_address, api_port, api_key) VALUES ($1, $2, $3, $4)", [name, ip_address, port, api_key]);
        await logAudit(req, 'admin.proxy.add', { name, ip_address });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/proxies/:id', async (req, res) => {
    const { name, ip_address, api_port, api_key } = req.body;
    try {
        if (name) await query("UPDATE edge_proxies SET name = $1 WHERE id = $2", [name, req.params.id]);
        if (ip_address) await query("UPDATE edge_proxies SET ip_address = $1 WHERE id = $2", [ip_address, req.params.id]);
        if (api_port) await query("UPDATE edge_proxies SET api_port = $1 WHERE id = $2", [api_port, req.params.id]);
        if (api_key) await query("UPDATE edge_proxies SET api_key = $1 WHERE id = $2", [api_key, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/proxies/:id', async (req, res) => {
    try {
        await query("DELETE FROM edge_proxies WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/proxies/:id/activate', async (req, res) => {
    try {
        await query("UPDATE edge_proxies SET is_active = false");
        await query("UPDATE edge_proxies SET is_active = true WHERE id = $1", [req.params.id]);
        await logAudit(req, 'admin.proxy.activate', { id: req.params.id });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// VENDOR MANAGEMENT FROM PANEL
// ==========================================
router.get('/vendors', async (req, res) => {
    try {
        const result = await query(`
            SELECT v.id, v.user_id, v.discord_username, v.portfolio_url, v.experience_summary, v.status, v.created_at, u.username as web_username
            FROM vendor_applications v
            LEFT JOIN users u ON v.user_id = u.id
            ORDER BY v.created_at DESC LIMIT 50
        `);
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo postulaciones' });
    }
});

router.post('/vendor/:appId/action', async (req, res) => {
    const { action } = req.body; // 'accepted', 'rejected', 'revoke'
    const appId = req.params.appId;

    if (!['accepted', 'rejected', 'revoke'].includes(action)) return res.status(400).json({ error: 'Acción inválida' });

    try {
        const app = await query('SELECT user_id FROM vendor_applications WHERE id = $1', [appId]);
        if (app.rowCount === 0) return res.status(404).json({ error: 'No encontrado' });

        if (action === 'revoke') {
            await query("UPDATE vendor_applications SET status = 'rejected' WHERE id = $1", [appId]);
            await query('UPDATE users SET role = $1 WHERE id = $2 AND role = $3', ['client', app.rows[0].user_id, 'vendor']);
            return res.json({ success: true, message: 'Permisos de vendedor revocados' });
        }

        await query('UPDATE vendor_applications SET status = $1 WHERE id = $2', [action, appId]);

        if (action === 'accepted') {
            await query('UPDATE users SET role = $1 WHERE id = $2 AND role = $3', ['vendor', app.rows[0].user_id, 'client']);
        }
        res.json({ success: true, message: `Vendedor ${action === 'accepted' ? 'aprobado' : 'rechazado'}` });
    } catch (e) {
        console.error("Error en vendor action:", e);
        res.status(500).json({ error: 'Error procesando la solicitud' });
    }
});

async function getLocalNodeHealth(nodeMeta = {}) {
  const mem = await si.mem();
  const ramPercent = (mem.active / mem.total) * 100;
  const load = await si.currentLoad();
  const disks = await si.fsSize();
  const heavyMounts = [
    config.instanceDataRoot,
    '/mnt/ragenodes-heavy',
    `${config.instanceDataRoot}/templates`,
    config.backupRoot
  ];
  const dataDisk = heavyMounts
    .map(mount => disks.find(d => d.mount === mount))
    .find(Boolean) || disks[0];
  const diskPercent = dataDisk ? dataDisk.use : 0;
  return {
    id: 0,
    name: nodeMeta.name || 'Master Node Titan R1',
    ip_address: nodeMeta.ip_address || 'localhost',
    status: nodeMeta.status || 'active',
    cpu: load.currentLoad,
    ram: ramPercent,
    ramGb: Number((mem.active / 1024 ** 3).toFixed(1)),
    ramTotal: Math.round(mem.total / 1024 ** 3),
    disk: diskPercent,
    diskGb: dataDisk ? Number((dataDisk.used / 1024 ** 3).toFixed(1)) : 0,
    diskTotal: dataDisk ? Math.round(dataDisk.size / 1024 ** 3) : 0,
    cpuCores: load.cpus?.length || nodeMeta.cpu_cores || 0,
    diskMount: dataDisk?.mount || null,
    source: dataDisk?.mount === config.instanceDataRoot ? 'host' : 'heavy-storage'
  };
}

async function getRemoteNodeHealth(node) {
  const docker = await getNodeConnection(node.id);
  const [info, containers, df] = await Promise.all([
    docker.info(),
    docker.listContainers({ all: false }),
    docker.df().catch(() => null)
  ]);

  let ramBytes = 0;
  let cpuDockerPercent = 0;
  const ragenodeContainers = containers.filter(c => c.Names?.some(n => n.startsWith('/ragenodes-')));
  await Promise.all(ragenodeContainers.map(async c => {
    try {
      const stats = await docker.getContainer(c.Id).stats({ stream: false });
      const memUsage = stats.memory_stats?.usage || 0;
      const memCache = stats.memory_stats?.stats?.cache || 0;
      ramBytes += Math.max(0, memUsage - memCache);

      const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage || 0) - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
      const systemDelta = (stats.cpu_stats?.system_cpu_usage || 0) - (stats.precpu_stats?.system_cpu_usage || 0);
      const onlineCpus = stats.cpu_stats?.online_cpus || info.NCPU || 1;
      if (cpuDelta > 0 && systemDelta > 0) cpuDockerPercent += (cpuDelta / systemDelta) * onlineCpus * 100;
    } catch (_) {}
  }));

  const totalRam = info.MemTotal || 0;
  const layersSize = df?.LayersSize || 0;
  const cpuPercentOfNode = info.NCPU ? Math.min(100, cpuDockerPercent / info.NCPU) : 0;

  return {
    id: Number(node.id),
    name: node.name,
    ip_address: node.ip_address,
    status: node.status,
    cpu: cpuPercentOfNode,
    ram: totalRam ? (ramBytes / totalRam) * 100 : 0,
    ramGb: Number((ramBytes / 1024 ** 3).toFixed(1)),
    ramTotal: Math.round(totalRam / 1024 ** 3),
    disk: 0,
    diskGb: Number((layersSize / 1024 ** 3).toFixed(1)),
    diskTotal: null,
    cpuCores: info.NCPU || node.cpu_cores || 0,
    containers: ragenodeContainers.length,
    source: 'docker'
  };
}

router.get('/system-health', async (req, res) => {
  try {
    const nodesResult = await query("SELECT * FROM nodes ORDER BY id ASC");
    const nodes = nodesResult.rows;
    const selectedId = Number(req.query.nodeId ?? 0);
    const selectedMeta = nodes.find(n => Number(n.id) === selectedId) || nodes.find(n => Number(n.id) === 0) || {};
    const selected = selectedId === 0
      ? await getLocalNodeHealth(selectedMeta)
      : await getRemoteNodeHealth(selectedMeta);

    res.json({
      ...selected,
      selectedNodeId: selected.id,
      nodes: nodes.map(n => ({
        id: Number(n.id),
        name: n.name,
        ip_address: n.ip_address,
        status: n.status,
        cpu_cores: n.cpu_cores,
        ram_total_gb: n.ram_total_gb
      }))
    });
  } catch (e) {
    console.error("Error leyendo métricas:", e);
    res.status(500).json({ error: 'Fallo al leer métricas del Host' });
  }
});

router.post('/users', async (req, res) => {
  const { username, password, role, plan } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Faltan campos obligatorios' });

  const existing = await query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing.rowCount) return res.status(400).json({ error: 'El usuario ya existe' });

  const hash = await bcrypt.hash(password, 12);
  const targetRole = role === 'admin' ? 'admin' : 'client';
  const targetPlan = plan || 'hobby';

  await query('INSERT INTO users (username, password_hash, role, plan, is_verified) VALUES ($1, $2, $3, $4, true)',
              [username, hash, targetRole, targetPlan]);

  await logAudit(req, 'admin.user.create_manual', { createdUsername: username, targetRole });
  res.json({ success: true });
});

router.put('/users/:id', async (req, res) => {
  const { username, email, role, plan, password, expires_at } = req.body;
  const targetId = req.params.id;

  try {
    if (username) await query('UPDATE users SET username = $1 WHERE id = $2', [username, targetId]);
    if (email) await query('UPDATE users SET email = $1 WHERE id = $2', [email, targetId]);
    if (role && req.user.sub != targetId) await query('UPDATE users SET role = $1 WHERE id = $2', [role, targetId]);
    if (plan) await query('UPDATE users SET plan = $1 WHERE id = $2', [plan, targetId]);
    if (req.body.server_limit !== undefined) await query('UPDATE users SET server_limit = $1 WHERE id = $2', [req.body.server_limit, targetId]);
    if (expires_at !== undefined) {
      await query('UPDATE users SET expires_at = $1 WHERE id = $2', [expires_at, targetId]);
      // 🔥 También actualizamos la fecha de caducidad de todos los servidores del usuario
      await query('UPDATE servers SET expires_at = $1 WHERE owner_id = $2', [expires_at, targetId]);
    }
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, targetId]);
    }

    await logAudit(req, 'admin.user.updated', { targetUserId: targetId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el usuario' });
  }
});

router.get('/users', async (_req, res) => {
  const result = await query("SELECT id, username, email, role, plan, expires_at, is_verified, created_at FROM users ORDER BY created_at DESC");
  res.json({ items: result.rows });
});

router.delete('/users/:id', async (req, res) => {
  const userId = req.params.id;
  const userServers = await query('SELECT id FROM servers WHERE owner_id = $1', [userId]);

  for (const srv of userServers.rows) {
      await deleteServer(srv.id, userId, true);
  }

  await query('DELETE FROM users WHERE id = $1 AND role != $2', [userId, 'admin']);
  await logAudit(req, 'admin.user.delete', { targetUserId: userId });
  res.json({ success: true });
});

router.post('/users/:id/impersonate', async (req, res) => {
  const userId = req.params.id;
  const result = await query('SELECT id, username, email, role, is_verified, token_version FROM users WHERE id = $1', [userId]);
  if (!result.rowCount) return res.status(404).json({ error: 'Usuario no encontrado' });

  const user = result.rows[0];

  setSessionCookie(res, signToken(user));
  res.json({ user });
});

router.post('/invite-keys', async (req, res) => {
  const maxUses = req.body.maxUses || 1;
  const code = `RAGENODES-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const created = await query('INSERT INTO invite_keys (code, created_by, max_uses) VALUES ($1, $2, $3) RETURNING *', [code, req.user.sub, maxUses]);
  await logAudit(req, 'admin.invite_key.create', { code, maxUses });
  res.json({ inviteKey: created.rows[0] });
});

router.get('/invite-keys', async (_req, res) => {
  const result = await query('SELECT * FROM invite_keys ORDER BY created_at DESC');
  res.json({ items: result.rows });
});

router.delete('/invite-keys/:code', async (req, res) => {
  const { code } = req.params;
  await query('DELETE FROM invite_keys WHERE code = $1', [code]);
  res.json({ success: true });
});

router.get('/servers', async (_req, res) => {
  import('../services/serverService.js').then(async ({ getServersForUser }) => {
     try {
         const servers = await getServersForUser(0, true);
         for (let s of servers) {
            const userResult = await query('SELECT username FROM users WHERE id = $1', [s.owner_id]);
            s.username = userResult.rows[0]?.username || 'Desconocido';
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

        const job = backupQueue.enqueue(
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
  const result = await query('SELECT * FROM notifications ORDER BY created_at DESC');
  res.json({ items: result.rows });
});

router.post('/notifications', async (req, res) => {
  const { title, content, type } = req.body;
  await query('INSERT INTO notifications (title, content, type) VALUES ($1, $2, $3)', [title, content, type || 'info']);
  res.json({ success: true });
});

router.delete('/notifications/:id', async (req, res) => {
  await query('DELETE FROM notifications WHERE id = $1', [req.params.id]);
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

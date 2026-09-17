import express from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { getServersForUser, getServerDetails, getServerLogs, getServerByIdForUser, getServerStatsHistory } from '../services/serverService.js';
import { controlServer } from '../services/serverControlService.js';
import { deleteServer } from '../services/serverDeletionService.js';
import { getSubusersForServer, addSubuserToServer, removeSubuserFromServer } from '../services/serverSubusers.js';
import { setServerBackupTime, updateServerWebhook, updateServerCluster, updateServerAutoRestart, toggleBlenderForServer, renewBlenderHeartbeat } from '../services/serverSettings.js';
import { config } from '../config.js';

// 🚀 AÑADIDO: Todos los servicios de Backups para el cliente (INCLUYENDO deleteBackup)
import { listServerBackups, deleteBackup } from '../services/backupService.js';
import { restoreBackup } from '../services/backupRestoreService.js';
import { backupQueue } from '../services/backupQueue.js';
import { logAudit } from '../db.js';

import { logHub } from '../services/logHub.js';
import { getDeploymentForOwner } from '../repositories/deploymentJobRepository.js';
import { planAndEnqueueDeployment } from '../services/deploymentPlanner.js';

const router = express.Router();

router.use(requireAuth);

router.get('/backup-jobs/:jobId', async (req, res) => {
    const job = await backupQueue.getJob(req.params.jobId, req.user.sub, req.user.role === 'admin');
    if (!job) return res.status(404).json({ error: 'Job no encontrado' });
    res.json(job);
});

router.get('/deployment-jobs/:jobId', async (req, res) => {
  const job = await getDeploymentForOwner(req.params.jobId, req.user.sub, req.user.role === 'admin');
  if (!job) return res.status(404).json({ error: 'Despliegue no encontrado' });
  res.json(job);
});

router.get('/', async (req, res) => {
  try {
    const items = await getServersForUser(req.user.sub, req.user.role === 'admin');
    res.json({ items, publicHost: config.fivemPublicHost });
  } catch (e) {
    req.log?.error?.(e, 'Error al listar servidores del usuario');
    res.status(500).json({ error: e.message || 'Error al obtener servidores' });
  }
});

router.post('/', async (req, res) => {
  try {
    const requestedKey = String(req.get('Idempotency-Key') || '').trim();
    const idempotencyKey = requestedKey.slice(0, 128) || crypto.randomUUID();
    const { job, plan } = await planAndEnqueueDeployment(req.user.sub, idempotencyKey, req.body);
    res.status(202).json({
      jobId: job.id,
      status: job.status,
      phase: job.phase,
      nodeId: plan.nodeId,
      queued: true,
      statusUrl: `/api/servers/deployment-jobs/${job.id}`
    });
  } catch (error) {
    if (error?.code === '23505') {
      return res.status(409).json({ error: 'Ya tienes un despliegue en curso.' });
    }
    res.status(400).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => { const item = await getServerDetails(req.params.id, req.user.sub, req.user.role === 'admin'); item ? res.json({ item, publicHost: config.fivemPublicHost }) : res.status(404).json({ error: 'No encontrado' }); });

// ==========================================
// 🚀 RUTAS DE BACKUPS (CLIENTES)
// ==========================================

// 1. Listar los backups del cliente
router.get('/:id/backups', async (req, res) => {
    try {
        const items = await listServerBackups(req.params.id, req.user.sub, req.user.role === 'admin');
        res.json({ items });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// 2. Generar un backup manual (Con soporte para nombre personalizado y COLA DE PRIORIDAD)
router.post('/:id/backup', async (req, res) => {
  try {
      const s = await getServerByIdForUser(req.params.id, req.user.sub, req.user.role === 'admin', 'files');
      if (!s) return res.status(404).json({ error: "Servidor no encontrado" });

      const job = await backupQueue.enqueue(
          req.params.id,
          req.user.sub,
          req.user.role === 'admin',
          req.body.customName,
          s.runtime_plan || 'hobby'
      );

      await logAudit(req, 'server.backup.enqueue', { serverId: req.params.id, customName: req.body.customName, jobId: job.jobId });
      res.status(202).json({ ...job, queued: true, statusUrl: `/api/servers/backup-jobs/${job.jobId}` });
  } catch(e) {
      console.error("[POST /servers/:id/backup]", e);
      res.status(500).json({ error: 'Error interno al crear backup.' });
  }
});

// 3. Restaurar un backup
router.post('/:id/backups/restore', async (req, res) => {
    try {
        const result = await restoreBackup(req.params.id, req.body.filename, req.user.sub, req.user.role === 'admin');
        await logAudit(req, 'server.backup.restore', { serverId: req.params.id, filename: req.body.filename });
        res.json(result);
    } catch (e) {
        console.error("[POST /servers/:id/backups/restore]", e);
        res.status(500).json({ error: 'Error interno al restaurar backup.' });
    }
});

// 4. Eliminar un backup (🚀 AÑADIDO PARA LA PAPELERA)
router.delete('/:id/backups/:filename', async (req, res) => {
    try {
        const result = await deleteBackup(req.params.id, req.params.filename, req.user.sub, req.user.role === 'admin');
        await logAudit(req, 'server.backup.delete', { serverId: req.params.id, filename: req.params.filename });
        res.json(result);
    } catch (e) {
        console.error("[DELETE /servers/:id/backups/:filename]", e);
        res.status(500).json({ error: 'Error interno al eliminar backup.' });
    }
});

// 5. Configurar hora de backup automático
router.post('/:id/backup-time', async (req, res) => {
    try {
        if (!req.body.time) return res.status(400).json({ error: "Falta el campo time" });
        const result = await setServerBackupTime(req.params.id, req.user.sub, req.body.time, req.user.role === 'admin');
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// ==========================================
// 🛑 RUTAS DE CONTROL Y EXTRAS
// ==========================================

router.post('/:id/:action(start|stop|restart)', async (req, res) => {
    try {
        const result = await controlServer(req.params.id, req.user.sub, req.params.action, req.user.role === 'admin');
        await logAudit(req, `server.power.${req.params.action}`, { serverId: req.params.id });
        res.json({ item: result });
    } catch(e) {
        res.status(400).json({ error: e.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const result = await deleteServer(req.params.id, req.user.sub, req.user.role === 'admin');
        await logAudit(req, 'server.delete', { serverId: req.params.id });
        res.json(result);
    } catch(e) {
        res.status(400).json({ error: e.message });
    }
});

router.get('/:id/logs', async (req, res) => { try { res.json(await getServerLogs(req.params.id, req.user.sub, req.user.role === 'admin')); } catch(e) { res.status(400).json({ error: e.message }); } });

// 🚀 NUEVO: Streaming de logs en tiempo real vía SSE (Optimizado con LogHub)
router.get('/:id/logs/stream', async (req, res) => {
    const serverId = req.params.id;
    const s = await getServerByIdForUser(serverId, req.user.sub, req.user.role === 'admin', 'console');
    if (!s) return res.status(404).end();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendLog = (data) => {
        if (res.writableEnded) return;
        res.write(`data: ${JSON.stringify({ msg: data })}\n\n`);
    };

    res.write('retry: 5000\n');
    res.write('event: open\ndata: {"status":"connected"}\n\n');

    // Evita que proxies HTTP/2, balanceadores y NAT cierren un stream inactivo.
    const heartbeat = setInterval(() => {
        if (res.writableEnded || res.destroyed) return;
        res.write(`: heartbeat ${Date.now()}\n\n`);
        res.flush?.();
    }, 15000);

    // Suscribirse al Hub compartido
    const logListener = (logs) => sendLog(logs);
    logHub.subscribe(serverId, logListener);

    const cleanup = () => {
        clearInterval(heartbeat);
        logHub.unsubscribe(serverId, logListener);
    };
    req.once('close', cleanup);
    res.once('close', cleanup);
});
router.get('/:id/stats-history', async (req, res) => { try { res.json({ items: await getServerStatsHistory(req.params.id, req.user.sub, req.user.role === 'admin') }); } catch(e) { res.status(400).json({ error: e.message }); } });

// 🎮 COMANDO INTERACTIVO: Enviar comando al stdin del contenedor
router.post('/:id/command', async (req, res) => {
    try {
        const { command } = req.body;
        if (!command || typeof command !== 'string') return res.status(400).json({ error: 'Comando inválido.' });
        if (command.length > 256) return res.status(400).json({ error: 'Comando demasiado largo.' });

        const s = await getServerByIdForUser(req.params.id, req.user.sub, req.user.role === 'admin', 'console');
        if (!s) return res.status(404).json({ error: 'Servidor no encontrado.' });
        if (s.status !== 'running') return res.status(400).json({ error: 'El servidor debe estar encendido.' });

        const { sendCommandToContainer } = await import('../services/dockerService.js');
        await sendCommandToContainer(s.container_name, command);

        await logAudit(req, 'server.command', { serverId: req.params.id, command });
        res.json({ ok: true });
    } catch (e) {
        console.error('[POST /servers/:id/command]', e.message);
        res.status(500).json({ error: e.message });
    }
});


router.get('/:id/blender-access', async (req, res) => {
  try {
    const s = await getServerByIdForUser(req.params.id, req.user.sub, req.user.role === 'admin', 'files');
    if (!s) return res.status(404).json({ error: "No encontrado" });
    res.json({
        host: config.fivemPublicHost,
        port: s.blender_port,
        user: 'abc',
        password: s.blender_pass,
        shortId: s.id.slice(0, 8)
    });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

router.post('/:id/blender/:action(start|stop)', async (req, res) => { try { res.json(await toggleBlenderForServer(req.params.id, req.user.sub, req.user.role === 'admin', req.params.action)); } catch(e) { res.status(400).json({ error: e.message }); } });
router.all('/:id/blender/heartbeat', async (req, res) => { try { res.json(await renewBlenderHeartbeat(req.params.id, req.user.sub, req.user.role === 'admin')); } catch(e) { res.status(400).json({ error: e.message }); } });

// ==========================================
// 🚀 ENDPOINTS DE CARACTERÍSTICAS PREMIUM
// ==========================================

// 1. Sub-usuarios (Equipo)
router.get('/:id/subusers', async (req, res) => {
    try { res.json({ items: await getSubusersForServer(req.params.id, req.user.sub, req.user.role === 'admin') }); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/:id/subusers', async (req, res) => {
    try { res.json(await addSubuserToServer(req.params.id, req.user.sub, req.user.role === 'admin', req.body.usernameOrEmail, req.body.permissions)); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:id/subusers/:subuserId', async (req, res) => {
    try { res.json(await removeSubuserFromServer(req.params.id, req.user.sub, req.user.role === 'admin', req.params.subuserId)); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

// 2. Webhooks de Discord
router.post('/:id/webhooks', async (req, res) => {
    try { res.json(await updateServerWebhook(req.params.id, req.user.sub, req.user.role === 'admin', req.body.webhookUrl, req.body.events)); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

// 3. Clústeres (Cross-ARK)
router.post('/:id/cluster', async (req, res) => {
    try { res.json(await updateServerCluster(req.params.id, req.user.sub, req.user.role === 'admin', req.body.clusterId)); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

// 4. Reinicios Automáticos
router.post('/:id/auto-restart', async (req, res) => {
    try { res.json(await updateServerAutoRestart(req.params.id, req.user.sub, req.user.role === 'admin', req.body.time, req.body.enabled, req.body.backupBeforeRestart)); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

// 5. Verificar versión ARK
router.post('/:id/force-update-ark', async (req, res) => {
    try {
        const s = await getServerByIdForUser(req.params.id, req.user.sub, req.user.role === 'admin', 'files');
        if (!s) return res.status(404).json({ error: 'Servidor no encontrado.' });
        if (s.game !== 'ark') return res.status(400).json({ error: 'Solo disponible para servidores ARK.' });

        const { localDocker, runRemoteCommand } = await import('../services/dockerService.js');
        // Delete appmanifest from both typical locations
        await runRemoteCommand(s.node_id, `docker exec ${s.container_name} bash -c "rm -f '/home/steam/Steam/steamapps/appmanifest_2430930.acf' && rm -f '/home/steam/Steam/steamapps/common/ARK Survival Ascended Dedicated Server/steamapps/appmanifest_2430930.acf' && rm -f /home/steam/CONTAINER_ALREADY_STARTED_PLACEHOLDER"`);
        // Restart container
        await controlServer(req.params.id, req.user.sub, 'restart', req.user.role === 'admin');
        
        await logAudit(req, 'server.force_update', { serverId: req.params.id });
        res.json({ ok: true });
    } catch (e) {
        console.error('[POST /servers/:id/force-update-ark]', e.message);
        res.status(500).json({ error: e.message });
    }
});

// 6. Instalador automático de dependencias
router.post('/:id/auto-install', async (req, res) => {
    try {
        const s = await getServerByIdForUser(req.params.id, req.user.sub, req.user.role === 'admin', 'files');
        if (!s) return res.status(404).json({ error: 'Servidor no encontrado.' });
        if (s.game !== 'discordbot') return res.status(400).json({ error: 'Solo disponible para Discord Bots.' });

        const type = req.body.type || 'npm';
        const { runRemoteCommand } = await import('../services/dockerService.js');
        
        let cmd = '';
        if (type === 'npm') {
            cmd = `docker exec -w /home/container ${s.container_name} bash -c "npm install"`;
        } else if (type === 'pip') {
            cmd = `docker exec -w /home/container ${s.container_name} bash -c "pip install -r requirements.txt"`;
        } else {
            return res.status(400).json({ error: 'Tipo inválido.' });
        }

        await runRemoteCommand(s.node_id, cmd);
        await logAudit(req, 'server.auto_install', { serverId: req.params.id, type });
        res.json({ ok: true, message: 'Dependencias instaladas correctamente.' });
    } catch (e) {
        console.error('[POST /servers/:id/auto-install]', e.message);
        res.status(500).json({ error: e.message });
    }
});

export default router;

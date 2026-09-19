import { query, logAudit } from '../../db.js';
import { controlServer } from '../../services/serverControlService.js';
import { deleteServer } from '../../services/serverDeletionService.js';
import { listServerBackups } from '../../services/backupService.js';
import { restoreBackup } from '../../services/backupRestoreService.js';
import { migrateResources } from '../../services/serverResourceMigrationService.js';
import { backupQueue } from '../../services/backupQueue.js';
import { getServerByIdForUser, getServersForUser } from '../../services/serverService.js';
import { findUsernameById } from '../../repositories/userRepository.js';

/**
 * Registers privileged server operations in specificity order.
 * Keep backup, migration, and exec routes before the generic action route.
 */
export function registerServerRoutes(router) {
  router.get('/servers', async (_req, res) => {
    try {
      const servers = await getServersForUser(0, true);
      for (const server of servers) {
        server.username = await findUsernameById(server.owner_id) || 'Desconocido';
      }
      res.json({ items: servers });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/servers/:id', async (req, res) => {
    const { name, plan } = req.body;
    try {
      if (name) await query('UPDATE servers SET name = $1 WHERE id = $2', [name, req.params.id]);
      if (plan) await query('UPDATE servers SET runtime_plan = $1 WHERE id = $2', [plan, req.params.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Error al editar el servidor' });
    }
  });

  router.delete('/servers/:id', async (req, res) => {
    try {
      await deleteServer(req.params.id, null, true);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/servers/:id/backups', async (req, res) => {
    try {
      const items = await listServerBackups(req.params.id, null, true);
      res.json({ items });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/servers/:id/backups/restore', async (req, res) => {
    try {
      const result = await restoreBackup(req.params.id, req.body.filename, null, true);
      await logAudit(req, 'admin.server.restore_backup', {
        serverId: req.params.id,
        backup: req.body.filename
      });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/servers/:id/backup', async (req, res) => {
    try {
      const server = await getServerByIdForUser(req.params.id, null, true);
      if (!server) return res.status(404).json({ error: 'Servidor no encontrado' });

      const job = await backupQueue.enqueue(
        req.params.id,
        req.user.sub,
        true,
        'admin_forced',
        'partner'
      );
      await logAudit(req, 'admin.server.force_backup.enqueue', {
        serverId: req.params.id,
        jobId: job.jobId
      });
      res.status(202).json({
        ...job,
        queued: true,
        statusUrl: `/api/admin/backup-jobs/${job.jobId}`
      });
    } catch (error) {
      console.error('Error en backup manual admin:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/servers/:id/migrate', async (req, res) => {
    try {
      const result = await migrateResources(req.params.id, req.body.targetServerId, true);
      await logAudit(req, 'admin.server.migrate', {
        oldServer: req.params.id,
        newServer: req.body.targetServerId
      });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/servers/:id/exec', async (req, res) => {
    try {
      const { command, cwd } = req.body;
      if (!command) return res.status(400).json({ error: 'Falta el comando' });

      const result = await query('SELECT container_name FROM servers WHERE id = $1', [req.params.id]);
      if (!result.rowCount) return res.status(404).json({ error: 'Servidor no encontrado' });

      try {
        const { executeCommandInContainer } = await import('../../services/dockerService.js');
        const execution = await executeCommandInContainer(result.rows[0].container_name, command, cwd || '/');
        await logAudit(req, 'admin.server.exec', { serverId: req.params.id, command, cwd });
        res.json({
          stdout: execution.stdout || '',
          stderr: execution.stderr || '',
          cwd: execution.cwd,
          error: null
        });
      } catch (error) {
        res.json({ stdout: '', stderr: '', error: error.message });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/servers/:id/:action', async (req, res) => {
    try {
      res.json({ item: await controlServer(req.params.id, null, req.params.action, true) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
}

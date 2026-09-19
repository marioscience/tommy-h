import { query, logAudit } from '../../db.js';
import {
  createNotification,
  deleteNotification,
  listAdminNotifications
} from '../../repositories/notificationRepository.js';

/** Registers admin-facing notifications and the immutable audit view. */
export function registerObservabilityRoutes(router) {
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

  router.get('/audit-logs/export', async (_req, res) => {
    const result = await query(`
      SELECT a.created_at, u.username, a.action, a.ip_address, a.details
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC
    `);

    let csv = 'Fecha,Usuario,Accion,IP,Detalles\n';
    for (const row of result.rows) {
      const details = JSON.stringify(row.details).replace(/"/g, '""');
      csv += `"${row.created_at.toISOString()}","${row.username || 'Sistema'}","${row.action}","${row.ip_address || ''}","${details}"\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=auditoria_ragenodes.csv');
    res.send(csv);
  });
}

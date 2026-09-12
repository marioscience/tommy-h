import { query } from '../../db.js';

/** Registers vendor-administration endpoints used exclusively by the bot. */
export function registerVendorRoutes(router, verifyApiKey) {
  router.post('/vendor-action/:applicationId', verifyApiKey, async (req, res) => {
    const { applicationId } = req.params;
    const { action } = req.body;
    if (!['accepted', 'saved', 'rejected', 'revoke'].includes(action)) {
      return res.status(400).json({ error: 'Acción no válida' });
    }

    try {
      const application = await query(
        'SELECT user_id FROM vendor_applications WHERE id = $1',
        [applicationId]
      );
      if (application.rowCount === 0) {
        return res.status(404).json({ error: 'Postulación no encontrada' });
      }

      const userId = application.rows[0].user_id;
      const status = action === 'saved'
        ? 'pending'
        : (action === 'revoke' ? 'revoked' : action);
      await query(
        'UPDATE vendor_applications SET status = $1, updated_at = NOW() WHERE id = $2',
        [status, applicationId]
      );

      if (action === 'accepted') {
        await query('UPDATE users SET role = $1 WHERE id = $2 AND role = $3', ['vendor', userId, 'user']);
      } else if (action === 'revoke') {
        await query('UPDATE users SET role = $1 WHERE id = $2 AND role = $3', ['user', userId, 'vendor']);
      }
      res.json({ ok: true, message: `Postulación ${action} correctamente.` });
    } catch (error) {
      console.error(`Error procesando acción de vendedor para app ${applicationId}:`, error);
      res.status(500).json({ error: 'Error interno procesando acción.' });
    }
  });

  router.get('/vendors', verifyApiKey, async (_req, res) => {
    try {
      const result = await query(`
        SELECT id, user_id, discord_username, portfolio_url, status, created_at
        FROM vendor_applications
        ORDER BY created_at DESC
        LIMIT 50
      `);
      res.json({ ok: true, vendors: result.rows });
    } catch (error) {
      console.error('Error listando vendedores:', error);
      res.status(500).json({ error: 'Error interno' });
    }
  });
}

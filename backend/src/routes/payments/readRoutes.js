import { config } from '../../config.js';
import { query } from '../../db.js';
import {
  getInvoiceForUser,
  listInvoicesForUser,
  renderInvoiceHtml
} from '../../services/billingEvidenceService.js';

/** Registers read-only payment configuration, catalog, and invoice endpoints. */
export function registerPaymentReadRoutes(router, requireAuth) {
  router.get('/client-config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const enabled = Boolean(config.paypalClient && process.env.PAYPAL_SECRET);
    res.json({
      enabled,
      clientId: enabled ? config.paypalClient : null,
      mode: config.paypalMode
    });
  });

  router.get('/plans', async (_req, res) => {
    try {
      const result = await query('SELECT * FROM hosting_plans WHERE is_active = true');
      res.json(result.rows);
    } catch {
      res.status(500).json({ error: 'Error al obtener planes.' });
    }
  });

  router.get('/disk-plans', async (_req, res) => {
    try {
      const result = await query('SELECT * FROM disk_plans WHERE is_active = true ORDER BY gb_amount ASC');
      res.json(result.rows);
    } catch {
      res.status(500).json({ error: 'Error al obtener planes de disco.' });
    }
  });

  router.get('/invoices', requireAuth, async (req, res) => {
    try {
      const invoices = await listInvoicesForUser(req.user.sub);
      res.json({ items: invoices });
    } catch (error) {
      console.error('[invoices:list]', error);
      res.status(500).json({ error: 'Error al obtener facturas.' });
    }
  });

  router.get('/invoices/:id.html', requireAuth, async (req, res) => {
    try {
      const invoice = await getInvoiceForUser(req.params.id, req.user.sub, req.user.role === 'admin');
      if (!invoice) return res.status(404).send('Factura no encontrada.');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="${invoice.invoice_number || 'factura'}.html"`);
      res.send(renderInvoiceHtml(invoice));
    } catch (error) {
      console.error('[invoices:html]', error);
      res.status(500).send('Error al generar factura.');
    }
  });
}

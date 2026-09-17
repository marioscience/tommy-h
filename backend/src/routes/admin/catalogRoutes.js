import { query, logAudit } from '../../db.js';

/** Registers commercial catalog administration independently from server operations. */
export function registerCatalogRoutes(router) {
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
    } catch {
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
    } catch (error) {
      res.status(500).json({ error: error.message });
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
    } catch {
      res.status(500).json({ error: 'Error al actualizar el plan' });
    }
  });

  router.get('/disk-plans', async (_req, res) => {
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
    } catch (error) {
      res.status(500).json({ error: error.message });
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

  router.put('/marketplace/scripts/:id', async (req, res) => {
    const { name, description, price, is_active, image_url } = req.body;
    try {
      await query(
        'UPDATE marketplace_scripts SET name = $1, description = $2, price = $3, is_active = $4, image_url = $5 WHERE id = $6',
        [name, description, price, is_active, image_url, req.params.id]
      );
      await logAudit(req, 'admin.marketplace.update', { script_id: req.params.id, name, price });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/paypal/sync-plans', async (req, res) => {
    try {
      const { createProduct, createBillingPlan } = await import('../../services/paypalService.js');
      let synced = 0;
      const hostingPlans = await query("SELECT * FROM hosting_plans WHERE paypal_plan_id IS NULL OR paypal_plan_id = ''");
      for (const planRecord of hostingPlans.rows) {
        const product = await createProduct(
          `HOST_${planRecord.id}`,
          `RageNodes Hosting: ${planRecord.name}`,
          `Suscripción al plan de servidor ${planRecord.name}`,
          planRecord.image_url
        );
        const plan = await createBillingPlan(product.id, planRecord.name, planRecord.price);
        await query('UPDATE hosting_plans SET paypal_plan_id = $1 WHERE id = $2', [plan.id, planRecord.id]);
        synced += 1;
      }

      const diskPlans = await query("SELECT * FROM disk_plans WHERE paypal_plan_id IS NULL OR paypal_plan_id = ''");
      for (const diskPlan of diskPlans.rows) {
        const product = await createProduct(
          `DISK_${diskPlan.id}`,
          `Expansión de Disco: ${diskPlan.gb_amount}GB`,
          `Ampliación de espacio extra global ${diskPlan.gb_amount}GB`,
          diskPlan.image_url
        );
        const plan = await createBillingPlan(product.id, `Expansión ${diskPlan.gb_amount}GB`, diskPlan.price);
        await query('UPDATE disk_plans SET paypal_plan_id = $1 WHERE id = $2', [plan.id, diskPlan.id]);
        synced += 1;
      }

      await logAudit(req, 'admin.paypal.sync_plans', { synced_count: synced });
      res.json({ success: true, message: `Sincronización completa. Se crearon ${synced} nuevos planes en PayPal.` });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error cargando paypalService' });
    }
  });
}

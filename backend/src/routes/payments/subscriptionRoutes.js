import { query, logAudit, withTransaction } from '../../db.js';
import paypal from '../../services/paypalService.js';
import { isPayPalSubscriptionId } from './paymentValidation.js';

/** Registers authenticated add-on and base-plan subscription management. */
export function registerSubscriptionRoutes(router, requireAuth) {
  router.post('/register-disk-subscription', requireAuth, async (req, res) => {
    const { subscriptionID, diskPlanId } = req.body;
    try {
      if (!isPayPalSubscriptionId(subscriptionID) || typeof diskPlanId !== 'string') {
        return res.status(400).json({ error: 'Datos de suscripcion invalidos.' });
      }

      const planResult = await query(
        'SELECT id, gb_amount, paypal_plan_id FROM disk_plans WHERE id = $1 AND is_active = true',
        [diskPlanId]
      );
      const diskPlan = planResult.rows[0];
      if (!diskPlan?.paypal_plan_id) {
        return res.status(400).json({ error: 'La expansion seleccionada no esta disponible.' });
      }

      const data = await paypal.getSubscriptionDetails(subscriptionID);
      if (data.status === 'ACTIVE' && data.id === subscriptionID && data.plan_id === diskPlan.paypal_plan_id) {
        await withTransaction(async (tx) => {
          await tx('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`paypal-sub:${subscriptionID}`]);
          const used = await tx(
            'SELECT id FROM users WHERE disk_sub_id = $1 AND id <> $2',
            [subscriptionID, req.user.sub]
          );
          if (used.rowCount > 0) throw new Error('SUBSCRIPTION_ALREADY_USED');
          await tx(
            'UPDATE users SET extra_disk_gb = $1, disk_sub_id = $2 WHERE id = $3',
            [diskPlan.gb_amount, subscriptionID, req.user.sub]
          );
        });
        await logAudit(req.user.sub, 'payment.disk_subscription', {
          diskPlanId,
          diskGb: diskPlan.gb_amount,
          sub_id: subscriptionID
        });
        return res.json({ success: true, message: `¡Expansion de ${diskPlan.gb_amount}GB activada!` });
      }
      res.status(400).json({ error: 'La suscripcion no esta activa o no corresponde a la expansion seleccionada.' });
    } catch (error) {
      if (error.message === 'SUBSCRIPTION_ALREADY_USED') {
        return res.status(409).json({ error: 'Esta suscripcion ya esta vinculada a otra cuenta.' });
      }
      res.status(500).json({ error: 'Error al verificar suscripción de disco.' });
    }
  });

  router.post('/revise-plan', requireAuth, async (req, res) => {
    const { newPlanId } = req.body;
    try {
      const userResult = await query('SELECT paypal_sub_id FROM users WHERE id = $1', [req.user.sub]);
      const subId = userResult.rows[0]?.paypal_sub_id;
      if (!subId) return res.status(400).json({ error: 'No tienes una suscripción activa base.' });

      const planResult = await query('SELECT paypal_plan_id FROM hosting_plans WHERE id = $1', [newPlanId]);
      const paypalPlanId = planResult.rows[0]?.paypal_plan_id;
      if (!paypalPlanId) {
        return res.status(400).json({ error: 'El plan seleccionado no tiene un ID de PayPal configurado.' });
      }

      const data = await paypal.reviseSubscription(subId, paypalPlanId);
      const approveLink = data.links?.find((link) => link.rel === 'approve')?.href;
      if (approveLink) return res.json({ success: true, approveUrl: approveLink });
      res.status(400).json({ error: 'No se pudo generar el cambio de plan.' });
    } catch {
      res.status(500).json({ error: 'Error al revisar plan.' });
    }
  });

  router.post('/confirm-revise', requireAuth, async (req, res) => {
    try {
      const userResult = await query('SELECT paypal_sub_id FROM users WHERE id = $1', [req.user.sub]);
      const subId = userResult.rows[0]?.paypal_sub_id;
      if (!subId) return res.status(400).json({ error: 'No tienes una suscripción activa.' });

      const data = await paypal.getSubscriptionDetails(subId);
      if (data.status === 'ACTIVE') {
        const planResult = await query(
          'SELECT id FROM hosting_plans WHERE paypal_plan_id = $1 AND is_active = true',
          [data.plan_id]
        );
        if (planResult.rowCount === 0) {
          return res.status(409).json({ error: 'El plan confirmado por PayPal no existe o no esta activo.' });
        }
        const confirmedPlan = planResult.rows[0].id;
        await query('UPDATE users SET plan = $1 WHERE id = $2', [confirmedPlan, req.user.sub]);
        await logAudit(req.user.sub, 'payment.plan_revised', {
          plan: confirmedPlan,
          paypal_plan_id: data.plan_id,
          sub_id: subId
        });
        return res.json({ success: true, plan: confirmedPlan, message: '¡Plan actualizado correctamente!' });
      }
      res.status(400).json({ error: 'El cambio aún no se refleja en PayPal.' });
    } catch {
      res.status(500).json({ error: 'Error al confirmar cambio de plan.' });
    }
  });
}

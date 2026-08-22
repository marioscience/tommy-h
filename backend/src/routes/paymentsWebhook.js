import express from 'express';
import { query } from '../db.js';
import paypal from '../services/paypalService.js';
import { config } from '../config.js';

const router = express.Router();

function isPayPalSubscriptionId(value) {
    return typeof value === 'string' && /^I-[A-Z0-9]+$/i.test(value);
}

/**
 * 6. WEBHOOK DE PAYPAL (Sincronización Automática)
 * Escucha eventos como BILLING.SUBSCRIPTION.CANCELLED o SUSPENDED
 */
router.post('/webhook', async (req, res) => {
    if (!config.paypalWebhooksEnabled) {
        return res.status(503).send('PayPal webhooks disabled in this environment');
    }
    const event = req.body;
    let eventClaimed = false;

    try {
        if (!event?.id || !event?.resource) return res.status(400).send('Invalid event');
        if (!(await paypal.verifyWebhookSignature(req.headers, event))) {
            return res.status(401).send('Invalid signature');
        }

        const claimed = await query(
            `INSERT INTO paypal_webhook_events (id, event_type)
             VALUES ($1, $2)
             ON CONFLICT (id) DO NOTHING
             RETURNING id`,
            [event.id, event.event_type || 'unknown']
        );
        if (claimed.rowCount === 0) return res.status(200).send('Already processed');
        eventClaimed = true;

        const eventType = event.event_type;
        const subId = (eventType === 'PAYMENT.SALE.COMPLETED' || eventType === 'BILLING.SUBSCRIPTION.PAYMENT.COMPLETED') 
                      ? event.resource.billing_agreement_id 
                      : event.resource.id;
                      
        if (!subId || !isPayPalSubscriptionId(subId)) {
            await query("UPDATE paypal_webhook_events SET status = 'ignored', processed_at = NOW() WHERE id = $1", [event.id]);
            return res.status(200).send('Ignored');
        }

        const actualSub = await paypal.getSubscriptionDetails(subId);
        
        if (!actualSub || actualSub.error) {
            console.error(`[Webhook] Intento de webhook inválido para sub: ${subId}`);
            throw new Error('PAYPAL_SUBSCRIPTION_NOT_FOUND');
        }

        let userResult = await query('SELECT id, username FROM users WHERE paypal_sub_id = $1', [subId]);
        
        if (userResult.rowCount > 0) {
            const user = userResult.rows[0];
            const renewalEvent = eventType === 'PAYMENT.SALE.COMPLETED'
                || eventType === 'BILLING.SUBSCRIPTION.PAYMENT.COMPLETED'
                || eventType === 'BILLING.SUBSCRIPTION.ACTIVATED';
            
            if (actualSub.status === 'CANCELLED' || actualSub.status === 'SUSPENDED' || actualSub.status === 'EXPIRED') {
                await query('UPDATE users SET expires_at = NOW() WHERE id = $1', [user.id]);
                console.log(`[Webhook] Suscripción de Hosting ${actualSub.status} para el usuario ${user.username}`);
            } else if (actualSub.status === 'ACTIVE' && renewalEvent) {
                await query("UPDATE users SET expires_at = NOW() + INTERVAL '1 month' WHERE id = $1", [user.id]);
                console.log(`[Webhook] Suscripción de Hosting RENOVADA para el usuario ${user.username}`);
            }
            await query("UPDATE paypal_webhook_events SET status = 'processed', processed_at = NOW() WHERE id = $1", [event.id]);
            return res.status(200).send('OK');
        }

        let diskResult = await query('SELECT id, username FROM users WHERE disk_sub_id = $1', [subId]);
        if (diskResult.rowCount > 0) {
            const user = diskResult.rows[0];
            
            if (actualSub.status === 'CANCELLED' || actualSub.status === 'SUSPENDED' || actualSub.status === 'EXPIRED') {
                await query('UPDATE users SET extra_disk_gb = 0, disk_sub_id = NULL WHERE id = $1', [user.id]);
                console.log(`[Webhook] Suscripción de Disco CANCELADA para el usuario ${user.username}`);
            }
        }

        await query("UPDATE paypal_webhook_events SET status = 'processed', processed_at = NOW() WHERE id = $1", [event.id]);
        return res.status(200).send('OK');

    } catch (error) {
        console.error("[Webhook] Error procesando evento de PayPal:", error);
        if (eventClaimed && event?.id) {
            await query('DELETE FROM paypal_webhook_events WHERE id = $1', [event.id]).catch(() => {});
        }
        return res.status(503).send('Webhook processing failed');
    }
});

export default router;

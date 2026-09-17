import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, logAudit, withTransaction } from '../db.js';
import { sendWelcomeEmail, sendVerificationEmail } from '../services/emailService.js';
import { requireAuth } from '../middleware/auth.js';
import paypal from '../services/paypalService.js';
import { rateLimit } from 'express-rate-limit';
import { registerPaymentReadRoutes } from './payments/readRoutes.js';
import { registerSubscriptionRoutes } from './payments/subscriptionRoutes.js';
import { isPayPalSubscriptionId } from './payments/paymentValidation.js';
import { registerAgreementRoutes } from './payments/agreementRoutes.js';
import { cleanAgreementValue, getRequestIp, getRequestUserAgent } from './payments/checkoutContext.js';

const router = express.Router();
const checkoutLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes de checkout. Inténtalo más tarde.' }
});

function buildInvoiceNumber(userId) {
    const now = new Date();
    return `RN-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}-${userId}-${String(Date.now()).slice(-8)}`;
}

registerPaymentReadRoutes(router, requireAuth);
registerAgreementRoutes(router, checkoutLimiter);

/**
 * 2. VERIFICAR SUSCRIPCION Y CREAR CUENTA
 */
router.post('/register-subscription', checkoutLimiter, async (req, res) => {
    const { subscriptionID, planId, username, email, password, agreementToken } = req.body;
    const ip = getRequestIp(req);
    const ua = getRequestUserAgent(req);

    try {
        if (!isPayPalSubscriptionId(subscriptionID)) return res.status(400).json({ error: 'ID de suscripcion invalido.' });
        if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
            return res.status(400).json({ error: 'La contrasena debe tener entre 8 y 128 caracteres.' });
        }
        if (!agreementToken) return res.status(400).json({ error: 'Falta la aceptacion legal del checkout.' });

        const agreementResult = await query(
            `SELECT * FROM user_agreements WHERE token = $1 AND consumed_at IS NULL AND expires_at > NOW()`,
            [agreementToken]
        );
        if (agreementResult.rowCount === 0) return res.status(400).json({ error: 'La aceptacion legal expiro. Vuelve a confirmar el checkout.' });

        const agreement = agreementResult.rows[0];
        const cleanUsername = cleanAgreementValue(username);
        const cleanEmail = cleanAgreementValue(email).toLowerCase();
        if (agreement.plan_id !== planId || agreement.email !== cleanEmail || agreement.username !== cleanUsername) {
            return res.status(400).json({ error: 'Los datos del checkout no coinciden con la aceptacion legal registrada.' });
        }

        const planResult = await query(
            'SELECT id, name, price, paypal_plan_id, features FROM hosting_plans WHERE id = $1 AND is_active = true',
            [planId]
        );
        if (planResult.rowCount === 0 || !planResult.rows[0].paypal_plan_id) {
            return res.status(400).json({ error: 'El plan seleccionado no esta disponible para suscripcion.' });
        }

        const plan = planResult.rows[0];
        const data = await paypal.getSubscriptionDetails(subscriptionID);
        if (data.id !== subscriptionID || data.plan_id !== plan.paypal_plan_id) {
            await logAudit(null, 'payment.subscription_entitlement_rejected', {
                requestedPlan: planId,
                receivedPayPalPlan: data.plan_id || null,
                subscriptionID
            }, ip, ua);
            return res.status(400).json({ error: 'La suscripcion no corresponde al plan seleccionado.' });
        }

        // Si la suscripcion existe en PayPal y su estado es ACTIVO
        if (data.status === 'ACTIVE') {
            const serverLimit = Number(plan.features?.serverLimit || plan.features?.server_limit || 1) || 1;
            const verifyToken = crypto.randomBytes(32).toString('hex');

            const expiresAt = new Date();
            expiresAt.setMonth(expiresAt.getMonth() + 1);

            const hash = await bcrypt.hash(password, 12);
            let newUserId;
            let paymentId;
            let invoiceNumber;

            await withTransaction(async (tx) => {
                await tx('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`paypal-sub:${subscriptionID}`]);

                const lockedAgreement = await tx(
                    `SELECT id FROM user_agreements
                     WHERE id = $1 AND token = $2 AND consumed_at IS NULL AND expires_at > NOW()
                     FOR UPDATE`,
                    [agreement.id, agreementToken]
                );
                if (lockedAgreement.rowCount === 0) throw new Error('CHECKOUT_ALREADY_CONSUMED');

                const usedSubscription = await tx(
                    `SELECT id FROM users WHERE paypal_sub_id = $1
                     UNION ALL
                     SELECT user_id AS id FROM payments WHERE paypal_subscription_id = $1
                     LIMIT 1`,
                    [subscriptionID]
                );
                if (usedSubscription.rowCount > 0) throw new Error('SUBSCRIPTION_ALREADY_USED');

                const result = await tx(
                    `INSERT INTO users (username, email, password_hash, role, expires_at, paypal_sub_id, plan, server_limit, verify_token)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
                    [cleanUsername, cleanEmail, hash, 'client', expiresAt, subscriptionID, planId, serverLimit, verifyToken]
                );

                newUserId = result.rows[0].id;
                invoiceNumber = buildInvoiceNumber(newUserId);

                const evidence = {
                    ip,
                    userAgent: ua,
                    plan: { id: plan.id, name: plan.name, price: plan.price, currency: 'USD', paypal_plan_id: plan.paypal_plan_id, features: plan.features },
                    paypal: { subscriptionID, status: data.status, create_time: data.create_time, status_update_time: data.status_update_time },
                    agreement: {
                        id: agreement.id,
                        accepted_at: agreement.accepted_at,
                        documents: agreement.document_snapshot,
                        accepted_terms: agreement.accepted_terms,
                        accepted_privacy: agreement.accepted_privacy,
                        accepted_refund: agreement.accepted_refund,
                        accepted_immediate_provision: agreement.accepted_immediate_provision,
                        accepted_renewal: agreement.accepted_renewal
                    },
                    service: { type: 'digital_game_server_hosting', provision: 'automatic_after_payment' }
                };

                const payment = await tx(
                    `INSERT INTO payments (user_id, paypal_order_id, paypal_subscription_id, plan_name, amount, currency, status, agreement_id, evidence)
                     VALUES ($1,$2,$3,$4,$5,'USD','COMPLETED',$6,$7)
                     RETURNING id`,
                    [newUserId, subscriptionID, subscriptionID, planId, plan.price || 0, agreement.id, JSON.stringify(evidence)]
                );
                paymentId = payment.rows[0].id;

                await tx(
                    `INSERT INTO invoices (
                        invoice_number, user_id, payment_id, agreement_id, paypal_subscription_id,
                        status, currency, subtotal, tax, total, plan_id, plan_name, customer_email, customer_username, evidence
                     ) VALUES ($1,$2,$3,$4,$5,'paid','USD',$6,0,$6,$7,$8,$9,$10,$11)`,
                    [invoiceNumber, newUserId, paymentId, agreement.id, subscriptionID, plan.price || 0, plan.id, plan.name, cleanEmail, cleanUsername, JSON.stringify(evidence)]
                );

                await tx(
                    `UPDATE user_agreements SET user_id = $1, paypal_subscription_id = $2, consumed_at = NOW() WHERE id = $3`,
                    [newUserId, subscriptionID, agreement.id]
                );

            });

            if (cleanEmail) {
                sendWelcomeEmail(cleanEmail, cleanUsername);
                sendVerificationEmail(cleanEmail, cleanUsername, verifyToken);
            }

            await logAudit(newUserId, 'payment.subscription_success', {
                plan: planId,
                sub_id: subscriptionID,
                agreement_id: agreement.id,
                payment_id: paymentId,
                invoice_number: invoiceNumber
            }, ip, ua);

            return res.json({ success: true, message: `Cuenta creada y Plan ${planId} activado!`, invoiceNumber });
        }

        res.status(400).json({ error: "La suscripcion no esta ACTIVA en PayPal." });

    } catch (error) {
        console.error("Error en registro tras pago:", error);
        if (error.message === 'CHECKOUT_ALREADY_CONSUMED' || error.message === 'SUBSCRIPTION_ALREADY_USED') {
            return res.status(409).json({ error: 'Este checkout o esta suscripcion ya se utilizaron.' });
        }
        res.status(500).json({ error: "Error interno al procesar el pago." });
    }
});

registerSubscriptionRoutes(router, requireAuth);

import paymentsWebhookRouter from './paymentsWebhook.js';

router.use(paymentsWebhookRouter);

export default router;

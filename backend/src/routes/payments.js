import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, logAudit, withTransaction } from '../db.js';
import { sendWelcomeEmail, sendVerificationEmail } from '../services/emailService.js';
import { requireAuth } from '../middleware/auth.js';
import paypal from '../services/paypalService.js';
import { config } from '../config.js';
import { listInvoicesForUser, getInvoiceForUser, renderInvoiceHtml } from '../services/billingEvidenceService.js';
import { rateLimit } from 'express-rate-limit';

const router = express.Router();
const checkoutLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes de checkout. Inténtalo más tarde.' }
});

function getRequestIp(req) {
    const forwarded = req.headers?.['x-forwarded-for'];
    return (forwarded ? forwarded.split(',')[0].trim() : req.ip) || req.connection?.remoteAddress || null;
}

function getRequestUserAgent(req) {
    return req.headers?.['user-agent'] || null;
}

function cleanAgreementValue(value = '') {
    return String(value).trim().slice(0, 160);
}

async function getActiveLegalDocuments() {
    const { rows } = await query(`
        SELECT type, version, title, url, content_hash, published_at
        FROM legal_documents
        WHERE is_active = true
        ORDER BY type, published_at DESC
    `);
    const latest = new Map();
    for (const doc of rows) if (!latest.has(doc.type)) latest.set(doc.type, doc);
    return Array.from(latest.values());
}

function buildInvoiceNumber(userId) {
    const now = new Date();
    return `RN-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}-${userId}-${String(Date.now()).slice(-8)}`;
}

function isPayPalSubscriptionId(value) {
    return typeof value === 'string' && /^I-[A-Z0-9]+$/i.test(value);
}


/**
 * 0. Obtener Planes y Precios Dinámicos
 */
router.get('/client-config', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const enabled = Boolean(config.paypalClient && process.env.PAYPAL_SECRET);
    res.json({
        enabled,
        clientId: enabled ? config.paypalClient : null,
        mode: config.paypalMode
    });
});

router.get('/plans', async (req, res) => {
    try {
        const result = await query('SELECT * FROM hosting_plans WHERE is_active = true');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener planes.' });
    }
});

/**
 * 0.1 Obtener Planes de Disco Activos
 */
router.get('/disk-plans', async (req, res) => {
    try {
        const result = await query('SELECT * FROM disk_plans WHERE is_active = true ORDER BY gb_amount ASC');
        res.json(result.rows);
    } catch (error) {
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

/**
 * 1. Verificar disponibilidad (Usuario y Correo) ANTES de abrir PayPal
 */
router.post('/check-availability', checkoutLimiter, async (req, res) => {
    const { username, email } = req.body;

    const existingUser = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUser.rowCount > 0) return res.status(400).json({ error: 'El nombre de usuario ya está en uso.' });

    const existingEmail = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingEmail.rowCount > 0) return res.status(400).json({ error: 'Este correo electrónico ya está registrado.' });

    res.json({ available: true });
});


/**
 * 1.1 Registrar aceptacion legal antes de abrir PayPal
 */
router.post('/checkout-agreement', checkoutLimiter, async (req, res) => {
    const { planId, username, email, acceptedTerms, acceptedPrivacy, acceptedRefund, acceptedImmediateProvision, acceptedRenewal } = req.body;
    const ip = getRequestIp(req);
    const ua = getRequestUserAgent(req);

    try {
        if (!planId || !username || !email) return res.status(400).json({ error: 'Faltan datos del checkout.' });
        if (!acceptedTerms || !acceptedPrivacy || !acceptedRefund || !acceptedImmediateProvision || !acceptedRenewal) {
            return res.status(400).json({ error: 'Debes aceptar los acuerdos legales antes de continuar.' });
        }

        const planResult = await query('SELECT id, name, price, paypal_plan_id, features FROM hosting_plans WHERE id = $1 AND is_active = true', [planId]);
        if (planResult.rowCount === 0) return res.status(400).json({ error: 'El plan seleccionado no esta disponible.' });

        const docs = await getActiveLegalDocuments();
        for (const required of ['terms', 'privacy', 'refund']) {
            if (!docs.some(d => d.type === required)) return res.status(500).json({ error: `Documento legal activo faltante: ${required}` });
        }

        const plan = planResult.rows[0];
        const token = crypto.randomBytes(32).toString('hex');
        const cleanUsername = cleanAgreementValue(username);
        const cleanEmail = cleanAgreementValue(email).toLowerCase();

        const inserted = await query(
            `INSERT INTO user_agreements (
                token, username, email, plan_id, plan_snapshot, document_snapshot,
                accepted_terms, accepted_privacy, accepted_refund, accepted_immediate_provision, accepted_renewal,
                ip_address, user_agent
             ) VALUES ($1,$2,$3,$4,$5,$6,true,true,true,true,true,$7,$8)
             RETURNING id, accepted_at, expires_at`,
            [
                token,
                cleanUsername,
                cleanEmail,
                plan.id,
                JSON.stringify({ id: plan.id, name: plan.name, price: plan.price, currency: 'USD', paypal_plan_id: plan.paypal_plan_id, features: plan.features }),
                JSON.stringify(docs),
                ip,
                ua
            ]
        );

        await logAudit(null, 'legal.checkout_agreement.accepted', {
            agreementId: inserted.rows[0].id,
            plan: plan.id,
            username: cleanUsername,
            email: cleanEmail,
            documents: docs.map(d => ({ type: d.type, version: d.version, hash: d.content_hash }))
        }, ip, ua);

        res.json({ agreementToken: token, agreementId: inserted.rows[0].id, acceptedAt: inserted.rows[0].accepted_at, expiresAt: inserted.rows[0].expires_at });
    } catch (error) {
        console.error('[checkout-agreement]', error);
        res.status(500).json({ error: 'No se pudo registrar la aceptacion legal.' });
    }
});

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
        if (!diskPlan?.paypal_plan_id) return res.status(400).json({ error: 'La expansion seleccionada no esta disponible.' });

        const data = await paypal.getSubscriptionDetails(subscriptionID);

        if (data.status === 'ACTIVE' && data.id === subscriptionID && data.plan_id === diskPlan.paypal_plan_id) {
            await withTransaction(async (tx) => {
                await tx('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`paypal-sub:${subscriptionID}`]);
                const used = await tx('SELECT id FROM users WHERE disk_sub_id = $1 AND id <> $2', [subscriptionID, req.user.sub]);
                if (used.rowCount > 0) throw new Error('SUBSCRIPTION_ALREADY_USED');
                await tx('UPDATE users SET extra_disk_gb = $1, disk_sub_id = $2 WHERE id = $3', [diskPlan.gb_amount, subscriptionID, req.user.sub]);
            });
            await logAudit(req.user.sub, 'payment.disk_subscription', { diskPlanId, diskGb: diskPlan.gb_amount, sub_id: subscriptionID });
            return res.json({ success: true, message: `¡Expansion de ${diskPlan.gb_amount}GB activada!` });
        }
        res.status(400).json({ error: "La suscripcion no esta activa o no corresponde a la expansion seleccionada." });
    } catch (error) {
        if (error.message === 'SUBSCRIPTION_ALREADY_USED') {
            return res.status(409).json({ error: 'Esta suscripcion ya esta vinculada a otra cuenta.' });
        }
        res.status(500).json({ error: "Error al verificar suscripción de disco." });
    }
});

/**
 * 4. REVISAR PLAN (UPGRADE/DOWNGRADE)
 */
router.post('/revise-plan', requireAuth, async (req, res) => {
    const { newPlanId } = req.body; 

    try {
        const userResult = await query('SELECT paypal_sub_id FROM users WHERE id = $1', [req.user.sub]);
        const subId = userResult.rows[0]?.paypal_sub_id;

        if (!subId) return res.status(400).json({ error: "No tienes una suscripción activa base." });

        // 1. Obtener el PayPal Plan ID real desde la DB
        const planResult = await query('SELECT paypal_plan_id FROM hosting_plans WHERE id = $1', [newPlanId]);
        const paypalPlanId = planResult.rows[0]?.paypal_plan_id;

        if (!paypalPlanId) return res.status(400).json({ error: "El plan seleccionado no tiene un ID de PayPal configurado." });

        const data = await paypal.reviseSubscription(subId, paypalPlanId);
        
        const approveLink = data.links?.find(l => l.rel === 'approve')?.href;
        if (approveLink) return res.json({ success: true, approveUrl: approveLink });
        
        res.status(400).json({ error: "No se pudo generar el cambio de plan." });
    } catch (error) {
        res.status(500).json({ error: "Error al revisar plan." });
    }
});

/**
 * 5. CONFIRMAR CAMBIO DE PLAN
 */
router.post('/confirm-revise', requireAuth, async (req, res) => {
    try {
        const userResult = await query('SELECT paypal_sub_id FROM users WHERE id = $1', [req.user.sub]);
        const subId = userResult.rows[0]?.paypal_sub_id;

        if (!subId) return res.status(400).json({ error: "No tienes una suscripción activa." });

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
            await logAudit(req.user.sub, 'payment.plan_revised', { plan: confirmedPlan, paypal_plan_id: data.plan_id, sub_id: subId });
            return res.json({ success: true, plan: confirmedPlan, message: "¡Plan actualizado correctamente!" });
        }
        res.status(400).json({ error: "El cambio aún no se refleja en PayPal." });
    } catch (error) {
        res.status(500).json({ error: "Error al confirmar cambio de plan." });
    }
});

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
        // Si es un pago completado, el ID de suscripción está en billing_agreement_id
        const subId = (eventType === 'PAYMENT.SALE.COMPLETED' || eventType === 'BILLING.SUBSCRIPTION.PAYMENT.COMPLETED') 
                      ? event.resource.billing_agreement_id 
                      : event.resource.id;
                      
        if (!subId || !isPayPalSubscriptionId(subId)) {
            await query("UPDATE paypal_webhook_events SET status = 'ignored', processed_at = NOW() WHERE id = $1", [event.id]);
            return res.status(200).send('Ignored');
        }

        // Para evitar spoofing (falsificación del webhook), consultamos a PayPal directamente
        // usando el ID de suscripción que nos llegó. Si es falso, la llamada fallará o devolverá otro estado.
        const actualSub = await paypal.getSubscriptionDetails(subId);
        
        if (!actualSub || actualSub.error) {
            console.error(`[Webhook] Intento de webhook inválido para sub: ${subId}`);
            throw new Error('PAYPAL_SUBSCRIPTION_NOT_FOUND');
        }

        // Buscar a qué usuario pertenece esta suscripción (Hosting)
        let userResult = await query('SELECT id, username FROM users WHERE paypal_sub_id = $1', [subId]);
        
        if (userResult.rowCount > 0) {
            const user = userResult.rows[0];
            const renewalEvent = eventType === 'PAYMENT.SALE.COMPLETED'
                || eventType === 'BILLING.SUBSCRIPTION.PAYMENT.COMPLETED'
                || eventType === 'BILLING.SUBSCRIPTION.ACTIVATED';
            
            if (actualSub.status === 'CANCELLED' || actualSub.status === 'SUSPENDED' || actualSub.status === 'EXPIRED') {
                // Si se canceló en PayPal, forzamos que expires_at sea en este mismo momento
                // para que el billingScheduler lo suspenda en su próxima pasada (cada hora)
                await query('UPDATE users SET expires_at = NOW() WHERE id = $1', [user.id]);
                console.log(`[Webhook] Suscripción de Hosting ${actualSub.status} para el usuario ${user.username}`);
            } else if (actualSub.status === 'ACTIVE' && renewalEvent) {
                // Si se renovó/pagó, le damos 1 mes más desde la fecha actual
                await query("UPDATE users SET expires_at = NOW() + INTERVAL '1 month' WHERE id = $1", [user.id]);
                console.log(`[Webhook] Suscripción de Hosting RENOVADA para el usuario ${user.username}`);
            }
            await query("UPDATE paypal_webhook_events SET status = 'processed', processed_at = NOW() WHERE id = $1", [event.id]);
            return res.status(200).send('OK');
        }

        // Si no era de Hosting, buscar si es una suscripción de Disco
        let diskResult = await query('SELECT id, username FROM users WHERE disk_sub_id = $1', [subId]);
        if (diskResult.rowCount > 0) {
            const user = diskResult.rows[0];
            
            if (actualSub.status === 'CANCELLED' || actualSub.status === 'SUSPENDED' || actualSub.status === 'EXPIRED') {
                // Si cancela la expansión de disco, le quitamos los GB extra inmediatamente
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

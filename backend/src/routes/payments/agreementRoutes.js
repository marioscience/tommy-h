import crypto from 'crypto';
import { query, logAudit } from '../../db.js';
import { cleanAgreementValue, getRequestIp, getRequestUserAgent } from './checkoutContext.js';

async function getActiveLegalDocuments() {
  const { rows } = await query(`
    SELECT type, version, title, url, content_hash, published_at
    FROM legal_documents
    WHERE is_active = true
    ORDER BY type, published_at DESC
  `);
  const latest = new Map();
  for (const document of rows) {
    if (!latest.has(document.type)) latest.set(document.type, document);
  }
  return Array.from(latest.values());
}

/** Registers pre-payment availability and immutable legal-consent capture. */
export function registerAgreementRoutes(router, checkoutLimiter) {
  router.post('/check-availability', checkoutLimiter, async (req, res) => {
    const { username, email } = req.body;
    const existingUser = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUser.rowCount > 0) {
      return res.status(400).json({ error: 'El nombre de usuario ya está en uso.' });
    }

    const existingEmail = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingEmail.rowCount > 0) {
      return res.status(400).json({ error: 'Este correo electrónico ya está registrado.' });
    }
    res.json({ available: true });
  });

  router.post('/checkout-agreement', checkoutLimiter, async (req, res) => {
    const {
      planId,
      username,
      email,
      acceptedTerms,
      acceptedPrivacy,
      acceptedRefund,
      acceptedImmediateProvision,
      acceptedRenewal
    } = req.body;
    const ip = getRequestIp(req);
    const userAgent = getRequestUserAgent(req);

    try {
      if (!planId || !username || !email) {
        return res.status(400).json({ error: 'Faltan datos del checkout.' });
      }
      if (!acceptedTerms || !acceptedPrivacy || !acceptedRefund || !acceptedImmediateProvision || !acceptedRenewal) {
        return res.status(400).json({ error: 'Debes aceptar los acuerdos legales antes de continuar.' });
      }

      const planResult = await query(
        'SELECT id, name, price, paypal_plan_id, features FROM hosting_plans WHERE id = $1 AND is_active = true',
        [planId]
      );
      if (planResult.rowCount === 0) {
        return res.status(400).json({ error: 'El plan seleccionado no esta disponible.' });
      }

      const documents = await getActiveLegalDocuments();
      for (const required of ['terms', 'privacy', 'refund']) {
        if (!documents.some((document) => document.type === required)) {
          return res.status(500).json({ error: `Documento legal activo faltante: ${required}` });
        }
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
          JSON.stringify({
            id: plan.id,
            name: plan.name,
            price: plan.price,
            currency: 'USD',
            paypal_plan_id: plan.paypal_plan_id,
            features: plan.features
          }),
          JSON.stringify(documents),
          ip,
          userAgent
        ]
      );

      await logAudit(null, 'legal.checkout_agreement.accepted', {
        agreementId: inserted.rows[0].id,
        plan: plan.id,
        username: cleanUsername,
        email: cleanEmail,
        documents: documents.map((document) => ({
          type: document.type,
          version: document.version,
          hash: document.content_hash
        }))
      }, ip, userAgent);

      res.json({
        agreementToken: token,
        agreementId: inserted.rows[0].id,
        acceptedAt: inserted.rows[0].accepted_at,
        expiresAt: inserted.rows[0].expires_at
      });
    } catch (error) {
      console.error('[checkout-agreement]', error);
      res.status(500).json({ error: 'No se pudo registrar la aceptacion legal.' });
    }
  });
}

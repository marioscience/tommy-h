import AdmZip from 'adm-zip';
import { query } from '../db.js';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(value, currency = 'USD') {
  const number = Number(value || 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(number);
}

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function safeJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function renderInvoiceHtml(invoice) {
  const evidence = safeJson(invoice.evidence, {});
  const agreement = safeJson(invoice.agreement_snapshot, null) || safeJson(evidence?.agreement, {});
  const docs = safeJson(invoice.document_snapshot, null) || agreement?.documents || [];
  const docRows = Array.isArray(docs) ? docs.map(doc => `
    <tr>
      <td>${escapeHtml(doc.type || '-')}</td>
      <td>${escapeHtml(doc.version || '-')}</td>
      <td>${escapeHtml(doc.title || '-')}</td>
      <td>${escapeHtml(doc.content_hash || '-')}</td>
    </tr>`).join('') : '';

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Factura ${escapeHtml(invoice.invoice_number)}</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, Arial, sans-serif; background: #07080d; color: #f7f7fb; }
    .page { width: 920px; max-width: calc(100% - 32px); margin: 32px auto; padding: 42px; border: 1px solid #25283a; border-radius: 18px; background: linear-gradient(145deg, #10111b, #08090f); }
    .top { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; border-bottom: 1px solid #25283a; padding-bottom: 28px; }
    .brand { font-size: 28px; font-weight: 900; letter-spacing: .04em; }
    .muted { color: #a7adbd; }
    .badge { display: inline-block; padding: 7px 12px; border-radius: 999px; background: rgba(16,185,129,.14); color: #34d399; border: 1px solid rgba(16,185,129,.35); font-weight: 800; text-transform: uppercase; font-size: 12px; }
    h1 { margin: 30px 0 8px; font-size: 34px; }
    h2 { margin-top: 34px; font-size: 18px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 22px; }
    .box { border: 1px solid #25283a; border-radius: 14px; padding: 18px; background: rgba(255,255,255,.025); }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { text-align: left; padding: 12px; border-bottom: 1px solid #25283a; vertical-align: top; }
    th { color: #a7adbd; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .total { font-size: 28px; font-weight: 900; text-align: right; }
    .evidence { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; color: #cbd5e1; overflow-wrap: anywhere; }
    @media print { body { background: #fff; color: #111827; } .page { margin: 0; max-width: none; border: 0; background: #fff; } .muted { color: #4b5563; } }
  </style>
</head>
<body>
  <main class="page">
    <section class="top">
      <div>
        <div class="brand">RageNodes</div>
        <div class="muted">Infraestructura para servidores de juego</div>
      </div>
      <div style="text-align:right">
        <span class="badge">${escapeHtml(invoice.status || 'paid')}</span>
        <div class="muted" style="margin-top:10px">Emitida: ${escapeHtml(formatDate(invoice.issued_at || invoice.created_at))}</div>
      </div>
    </section>

    <h1>Factura ${escapeHtml(invoice.invoice_number)}</h1>
    <div class="muted">Referencia PayPal: ${escapeHtml(invoice.paypal_subscription_id || invoice.paypal_order_id || '-')}</div>

    <section class="grid">
      <div class="box">
        <h2>Cliente</h2>
        <p><strong>${escapeHtml(invoice.customer_username || invoice.username || '-')}</strong></p>
        <p class="muted">${escapeHtml(invoice.customer_email || invoice.email || '-')}</p>
      </div>
      <div class="box">
        <h2>Servicio</h2>
        <p><strong>${escapeHtml(invoice.plan_name || invoice.plan_id || '-')}</strong></p>
        <p class="muted">Provision digital inmediata despues de pago confirmado.</p>
      </div>
    </section>

    <h2>Detalle</h2>
    <table>
      <thead><tr><th>Concepto</th><th>Plan</th><th style="text-align:right">Importe</th></tr></thead>
      <tbody>
        <tr>
          <td>Suscripcion mensual RageNodes</td>
          <td>${escapeHtml(invoice.plan_id || '-')}</td>
          <td style="text-align:right">${money(invoice.subtotal || invoice.total, invoice.currency || 'USD')}</td>
        </tr>
      </tbody>
    </table>
    <p class="total">Total: ${money(invoice.total, invoice.currency || 'USD')}</p>

    <h2>Aceptacion legal registrada</h2>
    <div class="box evidence">
      <div>Acuerdo ID: ${escapeHtml(invoice.agreement_id || agreement?.id || '-')}</div>
      <div>Fecha aceptacion: ${escapeHtml(formatDate(invoice.accepted_at || agreement?.accepted_at))}</div>
      <div>IP: ${escapeHtml(invoice.ip_address || evidence?.ip || '-')}</div>
      <div>User-Agent: ${escapeHtml(invoice.user_agent || evidence?.userAgent || '-')}</div>
    </div>
    <table>
      <thead><tr><th>Documento</th><th>Version</th><th>Titulo</th><th>Hash</th></tr></thead>
      <tbody>${docRows || '<tr><td colspan="4">Sin snapshot documental.</td></tr>'}</tbody>
    </table>
  </main>
</body>
</html>`;
}

export async function listInvoicesForUser(userId) {
  const { rows } = await query(`
    SELECT id, invoice_number, status, currency, total, plan_id, plan_name, paypal_subscription_id, issued_at, created_at
    FROM invoices
    WHERE user_id = $1
    ORDER BY COALESCE(issued_at, created_at) DESC
    LIMIT 100
  `, [userId]);
  return rows;
}

export async function getInvoiceForUser(invoiceId, userId, isAdmin = false) {
  const params = [invoiceId];
  let ownerGuard = '';
  if (!isAdmin) {
    params.push(userId);
    ownerGuard = 'AND i.user_id = $2';
  }
  const { rows } = await query(`
    SELECT i.*, u.username, u.email, p.paypal_order_id,
           a.accepted_at, a.ip_address, a.user_agent, a.document_snapshot, a.plan_snapshot AS agreement_snapshot
    FROM invoices i
    LEFT JOIN users u ON u.id = i.user_id
    LEFT JOIN payments p ON p.id = i.payment_id
    LEFT JOIN user_agreements a ON a.id = i.agreement_id
    WHERE i.id = $1 ${ownerGuard}
    LIMIT 1
  `, params);
  return rows[0] || null;
}

async function resolveEvidenceUser(filters) {
  if (filters.userId) {
    const { rows } = await query('SELECT * FROM users WHERE id = $1 LIMIT 1', [filters.userId]);
    if (rows[0]) return rows[0];
  }
  if (filters.email) {
    const { rows } = await query('SELECT * FROM users WHERE lower(email) = lower($1) LIMIT 1', [filters.email]);
    if (rows[0]) return rows[0];
  }
  if (filters.invoiceId) {
    const { rows } = await query('SELECT u.* FROM users u JOIN invoices i ON i.user_id = u.id WHERE i.id = $1 LIMIT 1', [filters.invoiceId]);
    if (rows[0]) return rows[0];
  }
  if (filters.paypalSubscriptionId) {
    const { rows } = await query(`
      SELECT * FROM users
      WHERE paypal_sub_id = $1 OR disk_sub_id = $1
      LIMIT 1
    `, [filters.paypalSubscriptionId]);
    if (rows[0]) return rows[0];
  }
  return null;
}

export async function buildEvidenceBundle(filters) {
  const user = await resolveEvidenceUser(filters);
  const params = [];
  const clauses = [];

  if (user?.id) { params.push(user.id); clauses.push(`user_id = $${params.length}`); }
  if (filters.invoiceId) { params.push(filters.invoiceId); clauses.push(`id = $${params.length}`); }
  if (filters.paypalSubscriptionId) { params.push(filters.paypalSubscriptionId); clauses.push(`paypal_subscription_id = $${params.length}`); }
  if (filters.email) { params.push(filters.email); clauses.push(`lower(customer_email) = lower($${params.length})`); }

  const invoiceWhere = clauses.length ? `WHERE ${clauses.join(' OR ')}` : 'WHERE false';
  const invoices = (await query(`SELECT * FROM invoices ${invoiceWhere} ORDER BY COALESCE(issued_at, created_at) DESC LIMIT 50`, params)).rows;

  const paymentParams = [];
  const paymentClauses = [];
  if (user?.id) { paymentParams.push(user.id); paymentClauses.push(`user_id = $${paymentParams.length}`); }
  if (filters.paypalSubscriptionId) {
    paymentParams.push(filters.paypalSubscriptionId);
    paymentClauses.push(`paypal_subscription_id = $${paymentParams.length} OR paypal_order_id = $${paymentParams.length}`);
  }
  const payments = (await query(`SELECT * FROM payments WHERE ${paymentClauses.length ? paymentClauses.join(' OR ') : 'false'} ORDER BY created_at DESC LIMIT 100`, paymentParams)).rows;

  const agreementParams = [];
  const agreementClauses = [];
  if (user?.id) { agreementParams.push(user.id); agreementClauses.push(`user_id = $${agreementParams.length}`); }
  if (filters.paypalSubscriptionId) { agreementParams.push(filters.paypalSubscriptionId); agreementClauses.push(`paypal_subscription_id = $${agreementParams.length}`); }
  if (filters.email) { agreementParams.push(filters.email); agreementClauses.push(`lower(email) = lower($${agreementParams.length})`); }
  const agreements = (await query(`SELECT * FROM user_agreements WHERE ${agreementClauses.length ? agreementClauses.join(' OR ') : 'false'} ORDER BY accepted_at DESC LIMIT 100`, agreementParams)).rows;

  const auditLogs = user?.id
    ? (await query(`
        SELECT id, action, details, ip_address, user_agent, created_at
        FROM audit_logs
        WHERE user_id = $1 OR (details->>'email') = $2 OR (details->>'sub_id') = $3
        ORDER BY created_at DESC
        LIMIT 500
      `, [user.id, user.email || '', filters.paypalSubscriptionId || user.paypal_sub_id || ''])).rows
    : [];

  const servers = user?.id
    ? (await query(`
        SELECT id, name, slug, template, runtime_plan, status, fivem_port, txadmin_port, container_name, data_path, created_at, expires_at
        FROM servers
        WHERE owner_id = $1
        ORDER BY created_at DESC
      `, [user.id])).rows
    : [];

  const legalDocuments = (await query(`
    SELECT type, version, title, url, content_hash, is_active, published_at, created_at
    FROM legal_documents
    ORDER BY type, published_at DESC
  `)).rows;

  return {
    generatedAt: new Date().toISOString(),
    filters,
    user,
    invoices,
    payments,
    agreements,
    auditLogs,
    servers,
    legalDocuments
  };
}

export function buildEvidenceZip(bundle) {
  const zip = new AdmZip();
  const json = value => Buffer.from(JSON.stringify(value, null, 2), 'utf8');
  const username = bundle.user?.username || bundle.filters.email || bundle.filters.paypalSubscriptionId || 'unknown';

  zip.addFile('summary.json', json({
    generatedAt: bundle.generatedAt,
    subject: {
      userId: bundle.user?.id || null,
      username: bundle.user?.username || null,
      email: bundle.user?.email || null,
      paypalSubId: bundle.user?.paypal_sub_id || bundle.filters.paypalSubscriptionId || null
    },
    counts: {
      invoices: bundle.invoices.length,
      payments: bundle.payments.length,
      agreements: bundle.agreements.length,
      auditLogs: bundle.auditLogs.length,
      servers: bundle.servers.length
    }
  }));
  zip.addFile('user.json', json(bundle.user || {}));
  zip.addFile('invoices.json', json(bundle.invoices));
  zip.addFile('payments.json', json(bundle.payments));
  zip.addFile('agreements.json', json(bundle.agreements));
  zip.addFile('audit_logs.json', json(bundle.auditLogs));
  zip.addFile('servers.json', json(bundle.servers));
  zip.addFile('legal_documents.json', json(bundle.legalDocuments));

  for (const invoice of bundle.invoices) {
    zip.addFile(`invoices/${invoice.invoice_number || invoice.id}.html`, Buffer.from(renderInvoiceHtml(invoice), 'utf8'));
  }

  zip.addFile('README.txt', Buffer.from(
    `RageNodes evidence package\nGenerated: ${bundle.generatedAt}\nSubject: ${username}\n\nThis package contains invoice, payment, legal agreement, audit, and server provisioning records.\n`,
    'utf8'
  ));
  return zip.toBuffer();
}

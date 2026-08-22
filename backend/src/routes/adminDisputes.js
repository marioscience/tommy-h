import express from 'express';
import { query, logAudit } from '../db.js';
import { buildEvidenceBundle, buildEvidenceZip } from '../services/billingEvidenceService.js';

const router = express.Router();

router.get('/evidence-summary', async (req, res) => {
    try {
        const filters = {
            userId: req.query.userId ? Number(req.query.userId) : null,
            invoiceId: req.query.invoiceId ? Number(req.query.invoiceId) : null,
            paypalSubscriptionId: req.query.paypalSubscriptionId || req.query.subscriptionId || null,
            email: req.query.email || null
        };
        if (!filters.userId && !filters.invoiceId && !filters.paypalSubscriptionId && !filters.email) {
            return res.status(400).json({ error: 'Indica userId, invoiceId, paypalSubscriptionId o email.' });
        }

        const bundle = await buildEvidenceBundle(filters);
        if (!bundle.user && bundle.invoices.length === 0 && bundle.payments.length === 0 && bundle.agreements.length === 0) {
            return res.status(404).json({ error: 'No hay evidencia para esos filtros.' });
        }

        res.json({
            generatedAt: bundle.generatedAt,
            user: bundle.user ? {
                id: bundle.user.id,
                username: bundle.user.username,
                email: bundle.user.email,
                plan: bundle.user.plan,
                paypal_sub_id: bundle.user.paypal_sub_id,
                created_at: bundle.user.created_at
            } : null,
            counts: {
                invoices: bundle.invoices.length,
                payments: bundle.payments.length,
                agreements: bundle.agreements.length,
                auditLogs: bundle.auditLogs.length,
                servers: bundle.servers.length
            },
            invoices: bundle.invoices.slice(0, 10).map(i => ({
                id: i.id,
                invoice_number: i.invoice_number,
                status: i.status,
                total: i.total,
                currency: i.currency,
                plan_id: i.plan_id,
                plan_name: i.plan_name,
                issued_at: i.issued_at || i.created_at
            })),
            servers: bundle.servers.slice(0, 20).map(s => ({
                id: s.id,
                name: s.name,
                template: s.template,
                status: s.status,
                fivem_port: s.fivem_port,
                created_at: s.created_at
            }))
        });
    } catch (error) {
        console.error('[admin:dispute-evidence-summary]', error);
        res.status(500).json({ error: 'Error obteniendo resumen de evidencia.' });
    }
});

router.get('/evidence.zip', async (req, res) => {
    try {
        const filters = {
            userId: req.query.userId ? Number(req.query.userId) : null,
            invoiceId: req.query.invoiceId ? Number(req.query.invoiceId) : null,
            paypalSubscriptionId: req.query.paypalSubscriptionId || req.query.subscriptionId || null,
            email: req.query.email || null
        };
        if (!filters.userId && !filters.invoiceId && !filters.paypalSubscriptionId && !filters.email) {
            return res.status(400).json({ error: 'Indica userId, invoiceId, paypalSubscriptionId o email.' });
        }

        const bundle = await buildEvidenceBundle(filters);
        if (!bundle.user && bundle.invoices.length === 0 && bundle.payments.length === 0 && bundle.agreements.length === 0) {
            return res.status(404).json({ error: 'No hay evidencia para esos filtros.' });
        }

        const zip = buildEvidenceZip(bundle);
        const subject = bundle.user?.username || filters.email || filters.paypalSubscriptionId || 'evidence';
        await logAudit(req, 'admin.dispute_evidence.export', {
            filters,
            subject,
            counts: {
                invoices: bundle.invoices.length,
                payments: bundle.payments.length,
                agreements: bundle.agreements.length,
                auditLogs: bundle.auditLogs.length,
                servers: bundle.servers.length
            }
        });
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="ragenodes-evidence-${String(subject).replace(/[^a-z0-9_-]/gi, '_')}.zip"`);
        res.send(zip);
    } catch (error) {
        console.error('[admin:dispute-evidence]', error);
        res.status(500).json({ error: 'Error generando evidencia.' });
    }
});

export default router;

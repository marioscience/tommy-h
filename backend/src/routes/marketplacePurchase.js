import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import AdmZip from 'adm-zip';
import { rustUtil } from '../utils/rustUtil.js';
import { query, logAudit, withTransaction } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import paypal from '../services/paypalService.js';
import { getServerByIdForUser } from '../services/serverService.js';
import { safeWriteFile, safeReadFile } from '../utils/fileUtil.js';

const router = express.Router();

function validateMarketplaceArchive(filePath, destination, maxExpandedBytes = 1024 * 1024 * 1024) {
    const destinationRoot = path.resolve(destination);
    const archive = new AdmZip(filePath);
    let expandedBytes = 0;
    for (const entry of archive.getEntries()) {
        const resolvedEntry = path.resolve(destinationRoot, entry.entryName);
        if (resolvedEntry !== destinationRoot && !resolvedEntry.startsWith(`${destinationRoot}${path.sep}`)) {
            throw new Error('El archivo contiene una ruta no permitida');
        }
        const unixMode = (Number(entry.header?.attr || 0) >>> 16) & 0xffff;
        if ((unixMode & 0o170000) === 0o120000) {
            throw new Error('El archivo contiene enlaces simbolicos no permitidos');
        }
        expandedBytes += Number(entry.header?.size || 0);
        if (!Number.isSafeInteger(expandedBytes) || expandedBytes > maxExpandedBytes) {
            throw new Error('El archivo excede 1 GB al descomprimirse');
        }
    }
}

// 3. CREAR ORDEN DE PAYPAL PARA SCRIPT
router.post('/purchase/create-order/:id', requireAuth, async (req, res) => {
    const scriptId = req.params.id;
    try {
        const script = await query('SELECT * FROM marketplace_scripts WHERE id = $1 AND is_active = true', [scriptId]);
        if (script.rowCount === 0) return res.status(404).json({ error: 'Script no encontrado' });

        const amount = script.rows[0].price;
        if (amount <= 0) return res.json({ free: true });

        const order = await paypal.createOrder(amount, `Script: ${script.rows[0].name}`, `SCRIPT_${scriptId}`);
        res.json(order);
    } catch (error) {
        res.status(500).json({ error: 'Error al iniciar el pago' });
    }
});

// 3.5 RECLAMAR SCRIPT GRATIS
router.post('/purchase/claim-free/:id', requireAuth, async (req, res) => {
    const scriptId = req.params.id;
    try {
        const script = await query('SELECT * FROM marketplace_scripts WHERE id = $1 AND is_active = true', [scriptId]);
        if (script.rowCount === 0) return res.status(404).json({ error: 'Script no encontrado' });

        if (script.rows[0].price > 0) {
            return res.status(400).json({ error: 'Este script no es gratis' });
        }

        const licenseKey = `VAULT-${crypto.randomBytes(16).toString('hex').toUpperCase()}`;
        await query('INSERT INTO marketplace_licenses (script_id, user_id, license_key) VALUES ($1, $2, $3)', [scriptId, req.user.sub, licenseKey]);
        
        res.json({ success: true, licenseKey });
    } catch (error) {
        res.status(500).json({ error: 'Error al reclamar el script' });
    }
});

// 4. CAPTURAR PAGO Y ENTREGAR LICENCIA
router.post('/purchase/capture/:orderId', requireAuth, async (req, res) => {
    const { orderId } = req.params;
    const { scriptId } = req.body;
    try {
        if (!/^[A-Z0-9]+$/i.test(orderId) || !/^\d+$/.test(String(scriptId))) {
            return res.status(400).json({ error: 'Datos de compra invalidos.' });
        }

        const scriptResult = await query(
            'SELECT id, name, price FROM marketplace_scripts WHERE id = $1 AND is_active = true',
            [scriptId]
        );
        if (scriptResult.rowCount === 0) return res.status(404).json({ error: 'Script no encontrado.' });
        const script = scriptResult.rows[0];
        if (Number(script.price) <= 0) return res.status(400).json({ error: 'Este script no requiere pago.' });

        const expectedCustomId = `SCRIPT_${script.id}`;
        const expectedAmount = Number(script.price);
        const order = await paypal.getOrderDetails(orderId);
        const orderedUnit = order.purchase_units?.find(unit => unit.custom_id === expectedCustomId);
        const orderedAmount = Number(orderedUnit?.amount?.value);
        if (!orderedUnit || orderedUnit.amount?.currency_code !== 'USD' || !Number.isFinite(orderedAmount) || Math.abs(orderedAmount - expectedAmount) > 0.001) {
            return res.status(400).json({ error: 'La orden no corresponde al script solicitado.' });
        }

        const capture = await paypal.captureOrder(orderId);
        if (capture.status === 'COMPLETED') {
            const purchaseUnit = capture.purchase_units?.find(unit => unit.custom_id === expectedCustomId);
            const completedCapture = purchaseUnit?.payments?.captures?.find(item => item.status === 'COMPLETED');
            const paidAmount = Number(completedCapture?.amount?.value);
            const currency = completedCapture?.amount?.currency_code;

            if (!purchaseUnit || !completedCapture || currency !== 'USD' || !Number.isFinite(paidAmount) || Math.abs(paidAmount - expectedAmount) > 0.001) {
                await logAudit(req.user.sub, 'marketplace.payment_entitlement_rejected', {
                    orderId,
                    requestedScriptId: script.id,
                    customId: purchaseUnit?.custom_id || null,
                    paidAmount: Number.isFinite(paidAmount) ? paidAmount : null,
                    expectedAmount,
                    currency: currency || null
                });
                return res.status(400).json({ error: 'El pago no corresponde al script solicitado.' });
            }

            const licenseKey = `VAULT-${crypto.randomBytes(16).toString('hex').toUpperCase()}`;
            await withTransaction(async (tx) => {
                await tx('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`paypal-order:${orderId}`]);
                await tx(
                    'INSERT INTO marketplace_licenses (script_id, user_id, license_key, paypal_order_id) VALUES ($1, $2, $3, $4)',
                    [script.id, req.user.sub, licenseKey, orderId]
                );
            });
            await logAudit(req.user.sub, 'marketplace.purchase_completed', { orderId, scriptId: script.id, amount: paidAmount, currency });
            return res.json({ success: true, licenseKey });
        }
        res.status(400).json({ error: 'Pago no completado.' });
    } catch (error) {
        if (error?.code === '23505') return res.status(409).json({ error: 'Esta orden ya fue canjeada.' });
        res.status(500).json({ error: 'Error al procesar el pago' });
    }
});

// 4. Mis licencias compradas
router.get('/my-licenses', requireAuth, async (req, res) => {
    try {
        const result = await query(
            `SELECT l.*, s.name as script_name, s.version 
             FROM marketplace_licenses l 
             JOIN marketplace_scripts s ON l.script_id = s.id 
             WHERE l.user_id = $1 ORDER BY l.created_at DESC`,
            [req.user.sub]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener tus licencias' });
    }
});

// 4.5 DESCARGAR SCRIPT COMPRADO
router.get('/purchase/download/:licenseKey', requireAuth, async (req, res) => {
    try {
        const { licenseKey } = req.params;
        const result = await query(
            `SELECT s.file_path, s.name 
             FROM marketplace_licenses l
             JOIN marketplace_scripts s ON l.script_id = s.id
             WHERE l.license_key = $1 AND l.user_id = $2`,
            [licenseKey, req.user.sub]
        );

        if (result.rowCount === 0) {
            return res.status(403).json({ error: 'Licencia inválida o no te pertenece.' });
        }

        const filePath = result.rows[0].file_path;
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'El archivo original ya no está disponible.' });
        }

        const fileName = `${result.rows[0].name.replace(/\s+/g, '_')}_Vault.zip`;
        res.download(filePath, fileName);
    } catch (error) {
        console.error('Error al descargar script:', error);
        res.status(500).json({ error: 'Error al iniciar la descarga' });
    }
});

// 4.6 INSTALAR SCRIPT DIRECTAMENTE EN EL SERVIDOR (FIVEM)
router.post('/purchase/install/:licenseKey', requireAuth, async (req, res) => {
    try {
        const { licenseKey } = req.params;
        const { serverId } = req.body;

        if (!serverId) {
            return res.status(400).json({ error: 'Debes proporcionar un ID de servidor.' });
        }

        const result = await query(
            `SELECT s.file_path, s.name 
             FROM marketplace_licenses l
             JOIN marketplace_scripts s ON l.script_id = s.id
             WHERE l.license_key = $1 AND l.user_id = $2`,
            [licenseKey, req.user.sub]
        );

        if (result.rowCount === 0) {
            return res.status(403).json({ error: 'Licencia inválida o no te pertenece.' });
        }

        const sanitizeSlug = (str) => str.toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_]+/g, '-')
            .replace(/^-+|-+$/g, '');

        const filePath = result.rows[0].file_path;
        const scriptName = sanitizeSlug(result.rows[0].name) || `script_${licenseKey.slice(-4)}`;
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'El archivo original del script ya no está disponible.' });
        }

        const server = await getServerByIdForUser(serverId, req.user.sub, req.user.role === 'admin', 'files');
        if (!server) {
            return res.status(403).json({ error: 'No tienes acceso a este servidor.' });
        }

        const shortId = server.id.slice(0, 8);
        const txDataPath = path.join(server.data_path, 'txData');
        let serverCfgDir = path.join(txDataPath, `fivem_${shortId}`);
        
        if (!fs.existsSync(serverCfgDir)) {
            serverCfgDir = path.join(txDataPath, 'default');
            if (!fs.existsSync(serverCfgDir)) {
                return res.status(500).json({ error: 'No se pudo encontrar la carpeta de configuración del servidor.' });
            }
        }

        const resourcesDir = path.join(serverCfgDir, 'resources', '[market]', scriptName);
        validateMarketplaceArchive(filePath, resourcesDir);
        await fsPromises.mkdir(resourcesDir, { recursive: true });

        const nativeResult = await rustUtil.unzip(filePath, resourcesDir);
        if (!nativeResult.success) {
            throw new Error(`Fallo al extraer el script del mercado: ${nativeResult.error}`);
        }

        const serverCfgPath = path.join(serverCfgDir, 'server.cfg');
        let cfgContent = await safeReadFile(serverCfgPath);
        
        if (cfgContent) {
            const ensureLine = `ensure ${scriptName}`;
            const licenseLine = `setr vault_license "${licenseKey}"`;
            
            let needsUpdate = false;
            let appendText = '\n\n# --- Instalado desde RageNodes Market ---';

            if (!cfgContent.includes(`setr vault_license "${licenseKey}"`)) {
                appendText += `\n${licenseLine}`;
                needsUpdate = true;
            }

            if (!cfgContent.includes(ensureLine)) {
                appendText += `\n${ensureLine}`;
                needsUpdate = true;
            }

            if (needsUpdate) {
                cfgContent += appendText + '\n';
                await safeWriteFile(serverCfgPath, cfgContent);
            }
        }

        await logAudit(req.user.sub, 'marketplace.install_script', { serverId, scriptName, licenseKey });

        res.json({ success: true, message: `Script ${scriptName} instalado correctamente en el servidor.` });
    } catch (error) {
        console.error('Error al instalar script:', error);
        res.status(500).json({ error: 'Error al instalar el script en el servidor' });
    }
});

export default router;

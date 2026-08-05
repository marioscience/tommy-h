import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { rustUtil } from '../utils/rustUtil.js';
import { query, logAudit } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js'; 
import paypal from '../services/paypalService.js';
import { getServerByIdForUser } from '../services/serverService.js';
import { safeWriteFile, safeReadFile } from '../utils/fileUtil.js';

const router = express.Router();

// 📁 Configuración de Multer para subida de Scripts (Moviendo al NFS para ahorrar BTRFS)
const uploadDir = path.join(config.backupRoot, 'marketplace_uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// 1. Obtener todos los scripts activos (Filtrado opcional por juego)
router.get('/scripts', async (req, res) => {
    try {
        const game = req.query.game || 'fivem';
        const result = await query('SELECT * FROM marketplace_scripts WHERE is_active = true AND game = $1 ORDER BY created_at DESC', [game]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener los scripts' });
    }
});

// 2. Postular como vendedor
router.post('/apply', requireAuth, async (req, res) => {
    const { discordUsername, portfolioUrl, experience } = req.body;
    
    if (!discordUsername) return res.status(400).json({ error: 'El usuario de Discord es obligatorio' });

    try {
        // Verificar si ya tiene una postulación pendiente
        const existing = await query('SELECT id FROM vendor_applications WHERE user_id = $1 AND status = \'pending\'', [req.user.sub]);
        if (existing.rowCount > 0) return res.status(400).json({ error: 'Ya tienes una postulación pendiente de revisión' });

        const insertRes = await query(
            'INSERT INTO vendor_applications (user_id, discord_username, portfolio_url, experience_summary) VALUES ($1, $2, $3, $4) RETURNING id',
            [req.user.sub, discordUsername, portfolioUrl, experience]
        );
        const appId = insertRes.rows[0].id;

        await logAudit(req.user.sub, 'marketplace.vendor_apply', { discord: discordUsername });

        // 🔥 NOTIFICACIÓN AL STAFF VÍA DISCORD WEBHOOK
        if (process.env.DISCORD_STAFF_WEBHOOK) {
            try {
                await fetch(process.env.DISCORD_STAFF_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: "RageNodes Marketplace",
                        avatar_url: "https://ragenodes.com/logo.png",
                        embeds: [{
                            title: "🚨 Nueva Postulación de Vendedor",
                            color: 0x6366f1,
                            fields: [
                                { name: "Usuario", value: req.user.username, inline: true },
                                { name: "Discord", value: discordUsername, inline: true },
                                { name: "Portfolio", value: portfolioUrl || "No proporcionado" },
                                { name: "Experiencia", value: experience || "Sin detalles" },
                                { name: "Acción Requerida", value: "Utiliza el **Panel de Moderación de Vendedores** (`/setup_vendedores`) para revisar, aceptar o rechazar esta solicitud.", inline: false }
                            ],
                            footer: { text: `RageNodes Marketplace System | ID: ${appId}` },
                            timestamp: new Date().toISOString()
                        }]
                    })
                });
            } catch (webErr) {
                console.error("Error enviando webhook a Discord:", webErr);
            }
        }

        res.json({ success: true, message: '¡Postulación enviada correctamente! El equipo de RageNodes la revisará pronto.' });
    } catch (error) {
        console.error('Error en postulación:', error);
        res.status(500).json({ error: 'Error al enviar la postulación' });
    }
});

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
        const capture = await paypal.captureOrder(orderId);
        if (capture.status === 'COMPLETED') {
            const licenseKey = `VAULT-${crypto.randomBytes(16).toString('hex').toUpperCase()}`;
            await query('INSERT INTO marketplace_licenses (script_id, user_id, license_key) VALUES ($1, $2, $3)', [scriptId, req.user.sub, licenseKey]);
            return res.json({ success: true, licenseKey });
        }
        res.status(400).json({ error: 'Pago no completado.' });
    } catch (error) {
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
        
        // Verificar que la licencia pertenece al usuario y obtener la ruta del archivo
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

        // 1. Verificar la licencia y obtener la ruta del script
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

        // 🛡️ SANITIZACIÓN DE RUTA PARA EVITAR PATH TRAVERSAL
        const sanitizeSlug = (str) => str.toLowerCase()
            .replace(/[^\w\s-]/g, '') // Eliminar caracteres especiales
            .replace(/[\s_]+/g, '-')  // Espacios/guiones bajos a guiones
            .replace(/^-+|-+$/g, ''); // Limpiar extremos

        const filePath = result.rows[0].file_path;
        const scriptName = sanitizeSlug(result.rows[0].name) || `script_${licenseKey.slice(-4)}`;
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'El archivo original del script ya no está disponible.' });
        }

        // 2. Verificar que el usuario sea el dueño del servidor
        const server = await getServerByIdForUser(serverId, req.user.sub, req.user.role === 'admin');
        if (!server) {
            return res.status(403).json({ error: 'No tienes acceso a este servidor.' });
        }

        // 3. Determinar la carpeta txData correcta
        const shortId = server.id.slice(0, 8);
        const txDataPath = path.join(server.data_path, 'txData');
        let serverCfgDir = path.join(txDataPath, `fivem_${shortId}`);
        
        if (!fs.existsSync(serverCfgDir)) {
            serverCfgDir = path.join(txDataPath, 'default');
            if (!fs.existsSync(serverCfgDir)) {
                return res.status(500).json({ error: 'No se pudo encontrar la carpeta de configuración del servidor.' });
            }
        }

        // 4. Extraer el ZIP en resources/[market]/<scriptName>
        const resourcesDir = path.join(serverCfgDir, 'resources', '[market]', scriptName);
        await fsPromises.mkdir(resourcesDir, { recursive: true });

        const nativeResult = await rustUtil.unzip(filePath, resourcesDir);
        if (!nativeResult.success) {
            throw new Error(`Fallo al extraer el script del mercado: ${nativeResult.error}`);
        }

        // 5. Inyectar Vault License y ensure en el server.cfg (USANDO ESCRITURA SEGURA)
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
        res.status(500).json({ error: 'Error interno al instalar el script en el servidor.' });
    }
});

// 🚀 4.7 INSTALACIÓN DE MODS DE MINECRAFT (UN CLIC)
router.post('/install-mod/:id', requireAuth, async (req, res) => {
    try {
        const modId = req.params.id;
        const { serverId } = req.body;

        if (!serverId) return res.status(400).json({ error: 'ID de servidor requerido' });

        // 1. Obtener datos del mod
        const modRes = await query('SELECT * FROM marketplace_scripts WHERE id = $1 AND game = \'minecraft\'', [modId]);
        if (modRes.rowCount === 0) return res.status(404).json({ error: 'Mod no encontrado o no pertenece a Minecraft' });
        const mod = modRes.rows[0];

        // 2. Verificar servidor
        const server = await getServerByIdForUser(serverId, req.user.sub, req.user.role === 'admin');
        if (!server || server.template !== 'minecraft') {
            return res.status(403).json({ error: 'Servidor no válido para instalación de mods' });
        }

        // 3. Ruta de destino: /mods/nombre.jar
        const modsDir = path.join(server.data_path, 'mods');
        await fsPromises.mkdir(modsDir, { recursive: true });
        
        const fileName = path.basename(mod.file_path);
        const destPath = path.join(modsDir, fileName);

        // Copiar el archivo del market al servidor del cliente
        await fsPromises.copyFile(mod.file_path, destPath);

        await logAudit(req.user.sub, 'marketplace.install_mod', { serverId, modName: mod.name });

        res.json({ success: true, message: `¡Mod "${mod.name}" instalado correctamente! Recuerda reiniciar el servidor.` });
    } catch (error) {
        console.error('Error al instalar mod:', error);
        res.status(500).json({ error: 'Error al instalar el mod' });
    }
});

// 5. VALIDACIÓN DEL VAULT (Lógica central de protección)
router.post('/vault/validate', async (req, res) => {
    const { licenseKey, serverIp } = req.body;

    if (!licenseKey) return res.status(400).json({ authenticated: false, error: 'License key missing' });

    try {
        const result = await query(
            'SELECT l.*, s.name FROM marketplace_licenses l JOIN marketplace_scripts s ON l.script_id = s.id WHERE l.license_key = $1 AND l.is_active = true',
            [licenseKey]
        );

        if (result.rowCount === 0) {
            return res.status(403).json({ authenticated: false, message: 'Invalid or inactive license' });
        }

        // Aquí podrías añadir lógica adicional como vincular el serverIp
        res.json({ 
            authenticated: true, 
            scriptName: result.rows[0].name,
            owner: result.rows[0].user_id,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ authenticated: false, error: 'Vault validation error' });
    }
});

// 6. SUBIDA DE SCRIPTS/MODS (Solo para Vendedores/Admin)
router.post('/upload', requireAuth, upload.single('scriptFile'), async (req, res) => {
    let { name, description, price, version, category, iconType, iconColor, imageUrl, game } = req.body;
    const authorId = req.user.sub;
    const filePath = req.file ? req.file.path : null;

    if (!filePath) return res.status(400).json({ error: 'El archivo es obligatorio' });

    try {
        const userCheck = await query('SELECT role FROM users WHERE id = $1', [authorId]);
        const isAdmin = userCheck.rows[0].role === 'admin';
        const isVendor = userCheck.rows[0].role === 'vendor';

        if (!isAdmin && !isVendor) {
            return res.status(403).json({ error: 'No tienes permisos de vendedor' });
        }

        // 🚀 MEJORA: Valores por defecto para "Subida Rápida" de Admin
        if (!name && req.file) {
            name = path.parse(req.file.originalname).name.replace(/[-_]/g, ' ');
            name = name.charAt(0).toUpperCase() + name.slice(1);
        }
        
        if (!price) price = 0.00;
        if (!description) description = `${game === 'minecraft' ? 'Mod' : 'Script'} subido por el equipo de RageNodes.`;
        if (!version) version = '1.0.0';
        if (!category) category = game === 'minecraft' ? 'mod' : 'utility';

        await query(
            'INSERT INTO marketplace_scripts (name, description, price, version, author_id, category, icon_type, icon_color, file_path, image_url, game) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
            [name, description, price, version, authorId, category, iconType || 'cube', iconColor || '#38bdf8', filePath, imageUrl || null, game || 'fivem']
        );

        await logAudit(authorId, 'marketplace.upload', { name, game: game || 'fivem' });

        res.json({ success: true, message: 'Subido correctamente.' });
    } catch (error) {
        console.error('Error al subir:', error);
        res.status(500).json({ error: 'Error interno al procesar la subida' });
    }
});

// 7. Mis scripts subidos (Vendedor)
router.get('/my-scripts', requireAuth, async (req, res) => {
    try {
        const result = await query('SELECT * FROM marketplace_scripts WHERE author_id = $1 ORDER BY created_at DESC', [req.user.sub]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener tus scripts' });
    }
});

// 8. Eliminar script (Admin o Dueño)
router.delete('/scripts/:id', requireAuth, async (req, res) => {
    try {
        const scriptId = req.params.id;
        const userId = req.user.sub;
        
        const userCheck = await query('SELECT role FROM users WHERE id = $1', [userId]);
        const isAdmin = userCheck.rows[0]?.role === 'admin';
        
        const scriptRes = await query('SELECT author_id, file_path, name FROM marketplace_scripts WHERE id = $1', [scriptId]);
        if (scriptRes.rowCount === 0) return res.status(404).json({ error: 'No encontrado' });
        
        const script = scriptRes.rows[0];
        if (!isAdmin && script.author_id !== userId) {
            return res.status(403).json({ error: 'Sin permiso' });
        }
        
        await query('DELETE FROM marketplace_scripts WHERE id = $1', [scriptId]);
        if (script.file_path && fs.existsSync(script.file_path)) {
            await fsPromises.unlink(script.file_path).catch(() => {});
        }
        
        res.json({ success: true, message: 'Eliminado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error interno' });
    }
});

export default router;

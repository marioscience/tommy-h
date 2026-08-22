import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { query, logAudit } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js'; 
import marketplacePurchaseRouter from './marketplacePurchase.js';

const router = express.Router();

// Configuración de Multer para subida de Scripts
const uploadDir = path.join(config.backupRoot, 'marketplace_uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const parsed = path.parse(path.basename(file.originalname));
        const safeBase = parsed.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'upload';
        cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${safeBase}${parsed.ext.toLowerCase()}`);
    }
});
const allowedUploadExtensions = new Set(['.zip', '.jar']);
const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        const extension = path.extname(path.basename(file.originalname)).toLowerCase();
        cb(null, allowedUploadExtensions.has(extension));
    }
});

async function requireVendorOrAdmin(req, res, next) {
    try {
        const userCheck = await query('SELECT role FROM users WHERE id = $1', [req.user.sub]);
        const role = userCheck.rows[0]?.role;
        if (role !== 'admin' && role !== 'vendor') {
            return res.status(403).json({ error: 'No tienes permisos de vendedor' });
        }
        next();
    } catch {
        res.status(500).json({ error: 'No se pudo validar el permiso de subida' });
    }
}

function receiveMarketplaceFile(req, res, next) {
    upload.single('scriptFile')(req, res, (error) => {
        if (!error) return next();
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'El archivo supera el limite de 100 MB' });
        }
        return res.status(400).json({ error: 'Archivo de subida invalido' });
    });
}

// 1. Obtener todos los scripts activos (Filtrado opcional por juego)
router.get('/scripts', async (req, res) => {
    try {
        const game = req.query.game;
        let queryStr = `SELECT id, name, description, price, version, category,
                    icon_type, icon_color, image_url, game, created_at
             FROM marketplace_scripts
             WHERE is_active = true`;
        const params = [];
        if (game && game !== 'all') {
            queryStr += ` AND game = $1`;
            params.push(game);
        }
        queryStr += ` ORDER BY created_at DESC`;
        const result = await query(queryStr, params);
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
        const existing = await query("SELECT id FROM vendor_applications WHERE user_id = $1 AND status = 'pending'", [req.user.sub]);
        if (existing.rowCount > 0) return res.status(400).json({ error: 'Ya tienes una postulacion pendiente de revision' });

        const insertRes = await query(
            'INSERT INTO vendor_applications (user_id, discord_username, portfolio_url, experience_summary) VALUES ($1, $2, $3, $4) RETURNING id',
            [req.user.sub, discordUsername, portfolioUrl, experience]
        );
        const appId = insertRes.rows[0].id;

        await logAudit(req.user.sub, 'marketplace.vendor_apply', { discord: discordUsername });

        if (process.env.DISCORD_STAFF_WEBHOOK) {
            try {
                await fetch(process.env.DISCORD_STAFF_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: "RageNodes Marketplace",
                        avatar_url: "https://ragenodes.com/logo.png",
                        embeds: [{
                            title: "Nueva Postulacion de Vendedor",
                            color: 0x6366f1,
                            fields: [
                                { name: "Usuario", value: req.user.username, inline: true },
                                { name: "Discord", value: discordUsername, inline: true },
                                { name: "Portfolio", value: portfolioUrl || "No proporcionado" },
                                { name: "Experiencia", value: experience || "Sin detalles" },
                                { name: "Accion Requerida", value: "Utiliza el Panel de Moderacion de Vendedores (/setup_vendedores) para revisar, aceptar o rechazar esta solicitud.", inline: false }
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

        res.json({ success: true, message: 'Postulacion enviada correctamente. El equipo de RageNodes la revisara pronto.' });
    } catch (error) {
        console.error('Error en postulacion:', error);
        res.status(500).json({ error: 'Error al enviar la postulacion' });
    }
});

// 3. Subir script (Vendedores o Admin)
router.post('/upload', requireAuth, requireVendorOrAdmin, receiveMarketplaceFile, async (req, res) => {
    try {
        const { name, description, price, version, category, game } = req.body;
        if (!name || !price || !req.file) {
            if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
            return res.status(400).json({ error: 'Faltan campos obligatorios o archivo' });
        }

        const numericPrice = Number(price);
        if (!Number.isFinite(numericPrice) || numericPrice < 0) {
            if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
            return res.status(400).json({ error: 'El precio debe ser un numero positivo' });
        }

        const targetGame = game || 'fivem';
        const targetCategory = category || 'scripts';
        const targetVersion = version || '1.0.0';

        const insertRes = await query(
            `INSERT INTO marketplace_scripts (
                name, description, price, version, category, file_path, author_id, game, is_active
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
             RETURNING id`,
            [name, description || '', numericPrice, targetVersion, targetCategory, req.file.path, req.user.sub, targetGame]
        );

        await logAudit(req.user.sub, 'marketplace.upload_script', { scriptId: insertRes.rows[0].id, name, price: numericPrice });

        res.json({ success: true, scriptId: insertRes.rows[0].id, message: 'Script subido al catalogo con exito.' });
    } catch (error) {
        if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
        console.error('Error al subir script al marketplace:', error);
        res.status(500).json({ error: 'Error al procesar la subida del script' });
    }
});

router.use(marketplacePurchaseRouter);

export default router;

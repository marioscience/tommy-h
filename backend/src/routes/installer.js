import express from 'express';
import { config } from '../config.js';
import { query } from '../db.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import net from 'net';

const router = express.Router();

function secretsEqual(left, right) {
    const leftDigest = crypto.createHash('sha256').update(String(left || '')).digest();
    const rightDigest = crypto.createHash('sha256').update(String(right || '')).digest();
    return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function validPem(value, label) {
    return typeof value === 'string'
        && value.length <= 32_000
        && value.startsWith(`-----BEGIN ${label}-----`)
        && value.includes(`-----END ${label}-----`);
}

// ==========================================
// 🚀 RUTA PÚBLICA DE INSTALACIÓN
// ==========================================
router.get('/', async (req, res) => {
    try {
        const scriptPath = path.join(config.projectRoot, 'scripts', 'node_installer', 'install_node.sh');
        const scriptContent = await fs.readFile(scriptPath, 'utf8');
        res.setHeader('Content-Type', 'text/plain');
        res.send(scriptContent);
    } catch (e) {
        console.error("[Installer] Error enviando script:", e);
        res.status(500).send("Error interno: No se pudo leer el script instalador.");
    }
});

// ==========================================
// 🚀 RUTA PROTEGIDA POR API_KEY GLOBAL
// ==========================================
router.post('/auto-register', async (req, res) => {
    try {
        const providedKey = req.headers['x-api-key'];
        
        if (!providedKey || !secretsEqual(providedKey, config.apiKey)) {
            return res.status(401).json({ error: "No autorizado. API_KEY inválida." });
        }

        const { ip_address, ca_pem, cert_pem, key_pem } = req.body;

        if (!net.isIP(String(ip_address || ''))
            || !validPem(cert_pem, 'CERTIFICATE')
            || !(validPem(key_pem, 'PRIVATE KEY') || validPem(key_pem, 'RSA PRIVATE KEY'))
            || (ca_pem && !validPem(ca_pem, 'CERTIFICATE'))) {
            return res.status(400).json({ error: "Faltan certificados o IP en el payload." });
        }

        // 1. Registrar o actualizar en la base de datos
        // Si ya existe un nodo con esa IP, lo re-vinculamos
        let nodeId;
        const check = await query("SELECT id FROM nodes WHERE ip_address = $1", [ip_address]);
        
        if (check.rowCount > 0) {
            nodeId = check.rows[0].id;
            await query("UPDATE nodes SET status = 'active' WHERE id = $1", [nodeId]);
            console.log(`[Installer] Nodo existente re-vinculado: ID ${nodeId} (${ip_address})`);
        } else {
            const result = await query(
                "INSERT INTO nodes (name, ip_address, status) VALUES ($1, $2, 'active') RETURNING id", 
                [`Core-${ip_address.replace(/\./g, '-')}`, ip_address]
            );
            nodeId = result.rows[0].id;
            console.log(`[Installer] Nuevo nodo registrado: ID ${nodeId} (${ip_address})`);
        }

        // 2. Guardar los certificados en el sistema de archivos del maestro
        const certsDir = path.join(config.projectRoot, 'certs');
        const nodeCertDir = path.join(certsDir, 'nodes', String(nodeId));
        const caDir = path.join(certsDir, 'ca');

        await fs.mkdir(nodeCertDir, { recursive: true });
        await fs.mkdir(caDir, { recursive: true });

        // Escribir los archivos
        if (ca_pem) {
            await fs.writeFile(path.join(caDir, 'ca.pem'), ca_pem, { mode: 0o600 });
        }
        await fs.writeFile(path.join(nodeCertDir, 'cert.pem'), cert_pem, { mode: 0o600 });
        await fs.writeFile(path.join(nodeCertDir, 'key.pem'), key_pem, { mode: 0o600 });

        res.json({ success: true, nodeId: nodeId, message: "Nodo auto-registrado correctamente." });
    } catch (e) {
        console.error("[Installer] Error en auto-register:", e);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

export default router;

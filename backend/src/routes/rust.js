import express from 'express';
import path from 'path';
import { requireAuth } from '../middleware/auth.js';
import * as ServerService from '../services/serverService.js';
import * as RustService from '../services/rustService.js';

const router = express.Router();

// 🛠️ Obtener configuración visual de Rust
router.get('/config/:id', requireAuth, async (req, res) => {
    try {
        const s = await ServerService.getServerByIdForUser(req.params.id, req.user.sub, req.user.role === 'admin', 'files');
        if (!s) return res.status(404).json({ error: "No encontrado" });
        const config = await RustService.getRustConfig(s.data_path);
        res.json(config);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 💾 Guardar configuración visual de Rust
router.post('/config/:id', requireAuth, async (req, res) => {
    try {
        const s = await ServerService.getServerByIdForUser(req.params.id, req.user.sub, req.user.role === 'admin', 'files');
        if (!s) return res.status(404).json({ error: "No encontrado" });
        await RustService.saveRustConfig(s.data_path, req.body);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// 💥 Limpieza de Servidor (Wipe)
router.post('/wipe/:id', requireAuth, async (req, res) => {
    try {
        const s = await ServerService.getServerByIdForUser(req.params.id, req.user.sub, req.user.role === 'admin', 'files');
        if (!s) return res.status(404).json({ error: "No encontrado" });
        
        const type = req.body.type; // 'map', 'bp', or 'full'
        const serverIdentityPath = path.join(s.data_path, 'server', 'ragenodes');
        
        const fs = await import('fs/promises');
        try {
            const files = await fs.readdir(serverIdentityPath);
            for (const file of files) {
                if (type === 'map' || type === 'full') {
                    if (file.endsWith('.sav') || file.endsWith('.map')) {
                        await fs.unlink(path.join(serverIdentityPath, file)).catch(() => {});
                    }
                }
                if (type === 'bp' || type === 'full') {
                    if (file.includes('player.blueprints') || file.includes('player.identities') || file.includes('player.tokens') || file.includes('player.deaths') || file.includes('sv.files')) {
                        await fs.unlink(path.join(serverIdentityPath, file)).catch(() => {});
                    }
                }
            }
        } catch (e) {
            // Ignore if directory doesn't exist
        }

        res.json({ success: true, message: "Wipe completado con éxito." });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;

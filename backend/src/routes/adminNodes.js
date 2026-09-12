import express from 'express';
import { query, logAudit } from '../db.js';
import { testNodeConnection } from '../utils/dockerNode.js';
import {
    createNode,
    deleteNode,
    findNodeEndpointById,
    listNodes,
    updateNode,
    updateNodeResources,
    updateNodeStatus
} from '../repositories/nodeRepository.js';

const router = express.Router();

// ==========================================
// 📡 GESTIÓN DE NODOS (Multi-Nodo)
// ==========================================

router.get('/nodes', async (req, res) => {
    try {
        res.json({ items: await listNodes() });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/nodes', async (req, res) => {
    const { name, ip_address, api_key } = req.body;
    if (!name || !ip_address || !api_key) return res.status(400).json({ error: "Faltan campos" });
    try {
        await createNode({ name, ipAddress: ip_address, apiKey: api_key });
        await logAudit(req, 'admin.node.add', { name, ip_address });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/nodes/:id', async (req, res) => {
    const { name, ip_address, api_key, status } = req.body;
    try {
        await updateNode(req.params.id, { name, ip_address, api_key, status });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/nodes/:id/test', async (req, res) => {
    try {
        const node = await findNodeEndpointById(req.params.id);
        if (!node) return res.status(404).json({ error: "Nodo no encontrado" });
        const testResult = await testNodeConnection(node.id, node.ip_address);
        
        await updateNodeResources(node.id, testResult);
        
        res.json({ success: true, resources: testResult });
    } catch (e) { 
        await updateNodeStatus(req.params.id, 'offline');
        res.status(500).json({ error: e.message }); 
    }
});

router.delete('/nodes/:id', async (req, res) => {
    if (req.params.id === '0') return res.status(400).json({ error: "No se puede eliminar el Nodo Maestro" });
    try {
        await deleteNode(req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 🛡️ GESTIÓN DE EDGE PROXIES
// ==========================================

router.get('/proxies', async (req, res) => {
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS edge_proxies (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                ip_address TEXT NOT NULL,
                api_port INTEGER NOT NULL DEFAULT 8090,
                api_key TEXT NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT false,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        const result = await query("SELECT * FROM edge_proxies ORDER BY id ASC");
        res.json({ items: result.rows, proxies: result.rows });
    } catch (e) {
        console.error("Error al obtener edge_proxies:", e);
        res.json({ items: [], proxies: [] });
    }
});

router.post('/proxies', async (req, res) => {
    const { name, ip_address, api_port, api_key } = req.body;
    if (!name || !ip_address || !api_key) return res.status(400).json({ error: "Faltan campos" });
    try {
        const port = api_port || 8090;
        await query("INSERT INTO edge_proxies (name, ip_address, api_port, api_key) VALUES ($1, $2, $3, $4)", [name, ip_address, port, api_key]);
        await logAudit(req, 'admin.proxy.add', { name, ip_address });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/proxies/:id', async (req, res) => {
    const { name, ip_address, api_port, api_key } = req.body;
    try {
        if (name) await query("UPDATE edge_proxies SET name = $1 WHERE id = $2", [name, req.params.id]);
        if (ip_address) await query("UPDATE edge_proxies SET ip_address = $1 WHERE id = $2", [ip_address, req.params.id]);
        if (api_port) await query("UPDATE edge_proxies SET api_port = $1 WHERE id = $2", [api_port, req.params.id]);
        if (api_key) await query("UPDATE edge_proxies SET api_key = $1 WHERE id = $2", [api_key, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/proxies/:id', async (req, res) => {
    try {
        await query("DELETE FROM edge_proxies WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/proxies/:id/activate', async (req, res) => {
    try {
        await query("UPDATE edge_proxies SET is_active = false");
        await query("UPDATE edge_proxies SET is_active = true WHERE id = $1", [req.params.id]);
        await logAudit(req, 'admin.proxy.activate', { id: req.params.id });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;

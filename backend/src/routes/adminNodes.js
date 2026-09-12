import express from 'express';
import { logAudit } from '../db.js';
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
import { activateEdgeProxy, createEdgeProxy, deleteEdgeProxy, listEdgeProxies, updateEdgeProxy } from '../repositories/edgeProxyRepository.js';

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
        const proxies = await listEdgeProxies();
        res.json({ items: proxies, proxies });
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
        await createEdgeProxy({ name, ipAddress: ip_address, apiPort: port, apiKey: api_key });
        await logAudit(req, 'admin.proxy.add', { name, ip_address });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/proxies/:id', async (req, res) => {
    const { name, ip_address, api_port, api_key } = req.body;
    try {
        await updateEdgeProxy(req.params.id, { name, ip_address, api_port, api_key });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/proxies/:id', async (req, res) => {
    try {
        await deleteEdgeProxy(req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/proxies/:id/activate', async (req, res) => {
    try {
        await activateEdgeProxy(req.params.id);
        await logAudit(req, 'admin.proxy.activate', { id: req.params.id });
        res.json({ success: true });
    } catch (e) {
        if (e.message === 'EDGE_PROXY_NOT_FOUND') return res.status(404).json({ error: 'Proxy no encontrado' });
        res.status(500).json({ error: e.message });
    }
});

export default router;

import express from 'express';
import { query } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { clampTimeout, httpProbe, onlyValidPorts } from '../services/diagnosticProbeService.js';
import {
  getDockerContainersFromPsOutput,
  getDockerPortMap,
  getDockerPs,
  getFirewallSnapshot,
  getNetworkSnapshot,
  getSystemSnapshot,
  getUdpListenersInsideContainers,
  summarizePortProbe
} from '../services/diagnosticSnapshotService.js';
import { registerDiagnosticSuiteRoutes } from './admin/diagnosticSuiteRoutes.js';

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/defaults', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, name, template, status, fivem_port, txadmin_port, container_name
      FROM servers
      WHERE fivem_port IS NOT NULL
      ORDER BY fivem_port ASC
    `);
    let ports = rows
      .map((server) => Number(server.fivem_port))
      .filter((port) => Number.isInteger(port) && port > 0);
    if (ports.length === 0) ports = [30120];
    res.json({
      publicHost: config.fivemPublicHost || process.env.FIVEM_PUBLIC_IP || '127.0.0.1',
      ports,
      servers: rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/run', async (req, res) => {
  const startedAt = Date.now();
  try {
    const ports = onlyValidPorts(req.body?.ports);
    const publicHost = String(req.body?.publicHost || req.body?.publicIp || '').trim();
    const timeoutMs = clampTimeout(req.body?.timeoutMs);
    if (!publicHost) {
      return res.status(400).json({ ok: false, error: 'Falta publicHost o publicIp en el body.' });
    }

    const portChecks = [];
    for (const port of ports) {
      const [localInfo, publicInfo, localDynamic, publicDynamic] = await Promise.all([
        httpProbe(`http://127.0.0.1:${port}/info.json`, timeoutMs),
        httpProbe(`http://${publicHost}:${port}/info.json`, timeoutMs),
        httpProbe(`http://127.0.0.1:${port}/dynamic.json`, timeoutMs),
        httpProbe(`http://${publicHost}:${port}/dynamic.json`, timeoutMs)
      ]);
      portChecks.push(summarizePortProbe(port, localInfo, publicInfo, localDynamic, publicDynamic));
    }

    const dockerPs = await getDockerPs();
    const containers = getDockerContainersFromPsOutput(dockerPs.stdout);
    const [dockerPorts, udpInside, firewall, network, system] = await Promise.all([
      getDockerPortMap(containers),
      getUdpListenersInsideContainers(containers, ports),
      getFirewallSnapshot(ports),
      getNetworkSnapshot(),
      getSystemSnapshot()
    ]);
    const globalStatus = portChecks.some((probe) => probe.status === 'critical')
      ? 'critical'
      : portChecks.some((probe) => probe.status === 'warning') ? 'warning' : 'ok';

    return res.json({
      ok: true,
      status: globalStatus,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      input: { publicHost, ports, timeoutMs },
      summary: {
        totalPorts: ports.length,
        ok: portChecks.filter((probe) => probe.status === 'ok').length,
        warning: portChecks.filter((probe) => probe.status === 'warning').length,
        critical: portChecks.filter((probe) => probe.status === 'critical').length
      },
      portChecks,
      docker: { ps: dockerPs, containers, ports: dockerPorts, udpInside },
      firewall,
      network,
      system
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message, durationMs: Date.now() - startedAt });
  }
});

router.get('/quick', async (req, res) => {
  try {
    const ports = onlyValidPorts(
      String(req.query.ports || '').split(',').map((value) => value.trim()).filter(Boolean)
    );
    const publicHost = String(req.query.publicHost || req.query.publicIp || '').trim();
    if (!publicHost) {
      return res.status(400).json({ ok: false, error: 'Falta publicHost o publicIp en query.' });
    }

    const results = [];
    for (const port of ports) {
      const dynamic = await httpProbe(`http://${publicHost}:${port}/dynamic.json`, 5000);
      results.push({
        port,
        ok: dynamic.ok,
        statusCode: dynamic.statusCode,
        durationMs: dynamic.durationMs,
        hostname: dynamic.parsed?.hostname || null,
        clients: dynamic.parsed?.clients ?? null,
        maxClients: dynamic.parsed?.sv_maxclients ?? null,
        error: dynamic.error || null
      });
    }
    res.json({ ok: true, generatedAt: new Date().toISOString(), publicHost, ports, results });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

registerDiagnosticSuiteRoutes(router);

export default router;

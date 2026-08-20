import express from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import http from 'http';
import https from 'https';
import { query } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { runStagingHealthSuite, getLatestTestResult, generateReportHtml } from '../services/stagingHealthTestRunner.js';

const router = express.Router();

router.use(requireAuth, requireAdmin);
const execFileAsync = promisify(execFile);

const DEFAULT_PORTS = [30127, 30132, 30133, 30136, 30138, 30139, 30140];
const MAX_CMD_TIMEOUT = 12000;
const MAX_HTTP_TIMEOUT = 8000;

function clampTimeout(value, fallback = MAX_HTTP_TIMEOUT) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 1000), 15000);
}

function onlyValidPorts(ports) {
  if (!Array.isArray(ports)) return DEFAULT_PORTS;

  return [...new Set(
    ports
      .map((p) => Number(p))
      .filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535)
  )];
}

function safeText(value, max = 20000) {
  if (!value) return '';
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}\n...[TRUNCATED]` : text;
}

async function runCommand(cmd, args = [], options = {}) {
  const startedAt = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: options.timeout || MAX_CMD_TIMEOUT,
      maxBuffer: options.maxBuffer || 1024 * 1024 * 3,
      shell: false
    });

    return {
      ok: true,
      cmd: [cmd, ...args].join(' '),
      durationMs: Date.now() - startedAt,
      stdout: safeText(stdout),
      stderr: safeText(stderr)
    };
  } catch (err) {
    return {
      ok: false,
      cmd: [cmd, ...args].join(' '),
      durationMs: Date.now() - startedAt,
      error: err.message,
      stdout: safeText(err.stdout),
      stderr: safeText(err.stderr)
    };
  }
}

function httpProbe(url, timeoutMs = MAX_HTTP_TIMEOUT) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const lib = url.startsWith('https:') ? https : http;

    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      let size = 0;
      let body = '';

      res.on('data', (chunk) => {
        size += chunk.length;

        if (body.length < 20000) {
          body += chunk.toString('utf8');
        }
      });

      res.on('end', () => {
        let parsed = null;

        try {
          parsed = JSON.parse(body);
        } catch (_) {}

        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 400,
          url,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
          size,
          parsed,
          bodyPreview: parsed ? undefined : safeText(body, 2000)
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      resolve({
        ok: false,
        url,
        durationMs: Date.now() - startedAt,
        error: err.message
      });
    });
  });
}

function filterLines(text, ports) {
  const patterns = [
    ...ports.map(String),
    'limit',
    'hashlimit',
    'recent',
    'connlimit',
    'DROP',
    'REJECT',
    'drop',
    'reject',
    'meter'
  ];

  return String(text || '')
    .split('\n')
    .filter((line) => patterns.some((p) => line.includes(p)))
    .join('\n');
}

async function getDockerPs() {
  return runCommand('docker', [
    'ps',
    '--format',
    'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  ]);
}

async function getDockerPortMap(containerNames = []) {
  const results = [];

  for (const name of containerNames) {
    if (!/^[-_.a-zA-Z0-9]+$/.test(name)) continue;

    const r = await runCommand('docker', ['port', name]);
    results.push({
      container: name,
      ...r
    });
  }

  return results;
}

async function getDockerContainersFromPsOutput(stdout) {
  const lines = String(stdout || '').split('\n').slice(1);
  const containers = [];

  for (const line of lines) {
    const name = line.trim().split(/\s+/)[0];

    // MEJORA: Eliminamos la búsqueda restrictiva /^ragenodes-/
    // Ahora escanea TODOS los contenedores que no sean el propio panel maestro
    if (
      name &&
      !name.includes('ultimate') &&
      !name.includes('master') &&
      !name.includes('panel') &&
      !containers.includes(name)
    ) {
      containers.push(name);
    }
  }

  return containers;
}

async function getUdpListenersInsideContainers(containerNames = [], ports = []) {
  const results = [];

  for (const name of containerNames) {
    if (!/^[-_.a-zA-Z0-9]+$/.test(name)) continue;

    const portRegex = ports.join('|');

    const r = await runCommand('docker', [
      'exec',
      name,
      'sh',
      '-lc',
      `ss -lunp 2>/dev/null | grep -E "(${portRegex})" || netstat -lunp 2>/dev/null | grep -E "(${portRegex})" || echo "UDP no visible dentro"`
    ]);

    results.push({
      container: name,
      ...r
    });
  }

  return results;
}

async function getFirewallSnapshot(ports) {
  const iptables = await runCommand('iptables-save', []);
  const nft = await runCommand('nft', ['list', 'ruleset']);

  return {
    iptables: {
      ok: iptables.ok,
      cmd: iptables.cmd,
      durationMs: iptables.durationMs,
      output: filterLines(`${iptables.stdout}\n${iptables.stderr}`, ports)
    },
    nftables: {
      ok: nft.ok,
      cmd: nft.cmd,
      durationMs: nft.durationMs,
      output: filterLines(`${nft.stdout}\n${nft.stderr}`, ports)
    }
  };
}

async function getNetworkSnapshot() {
  const ipAddr = await runCommand('ip', ['addr']);
  const ipRoute = await runCommand('ip', ['route']);
  const ssTcp = await runCommand('ss', ['-lntp']);
  const ssUdp = await runCommand('ss', ['-lunp']);

  return {
    ipAddr,
    ipRoute,
    ssTcp,
    ssUdp
  };
}

async function getSystemSnapshot() {
  const load = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  const df = await runCommand('df', ['-h']);
  const free = await runCommand('free', ['-h']);
  const uptime = await runCommand('uptime', []);

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptimeSeconds: os.uptime(),
    loadavg: load,
    cpuCount: os.cpus()?.length || 0,
    memory: {
      totalBytes: totalMem,
      freeBytes: freeMem,
      usedBytes: totalMem - freeMem,
      usedPct: Number((((totalMem - freeMem) / totalMem) * 100).toFixed(2))
    },
    commands: {
      df,
      free,
      uptime
    }
  };
}

function summarizePortProbe(port, localInfo, publicInfo, localDynamic, publicDynamic) {
  let status = 'ok';
  const warnings = [];

  // MEJORA: Priorizamos la conexión Pública. 
  // Si el servidor responde públicamente, está Vivo. Ignoramos si 127.0.0.1 falla por el aislamiento de Docker.
  if (!publicInfo?.ok) {
    status = 'critical';
    warnings.push('info.json (Público) OFF');
  }

  if (!publicDynamic?.ok) {
    status = status === 'critical' ? status : 'warning';
    warnings.push('dynamic.json (Público) OFF');
  }

  // Notificamos fallo local solo como nota técnica (aislamiento de bridge Docker)
  if ((!localInfo?.ok || !localDynamic?.ok) && publicInfo?.ok) {
    warnings.push('Localhost OFF (Normal en aislamiento Docker)');
  }

  return {
    port,
    status,
    hostname:
      publicDynamic?.parsed?.hostname ||
      localDynamic?.parsed?.hostname ||
      publicInfo?.parsed?.vars?.sv_projectName ||
      localInfo?.parsed?.vars?.sv_projectName ||
      null,
    clients:
      publicDynamic?.parsed?.clients ??
      localDynamic?.parsed?.clients ??
      null,
    maxClients:
      publicDynamic?.parsed?.sv_maxclients ??
      localDynamic?.parsed?.sv_maxclients ??
      publicInfo?.parsed?.vars?.sv_maxClients ??
      localInfo?.parsed?.vars?.sv_maxClients ??
      null,
    checks: {
      localInfo,
      publicInfo,
      localDynamic,
      publicDynamic
    },
    warnings
  };
}


router.get('/defaults', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, name, template, status, fivem_port, txadmin_port, container_name
      FROM servers
      WHERE fivem_port IS NOT NULL
      ORDER BY fivem_port ASC
    `);

    let ports = rows
      .map((s) => Number(s.fivem_port))
      .filter((p) => Number.isInteger(p) && p > 0);

    if (ports.length === 0) {
      ports = [30120];
    }

    res.json({
      publicHost: config.fivemPublicHost || process.env.FIVEM_PUBLIC_IP || '127.0.0.1',
      ports,
      servers: rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/run', async (req, res) => {
  const startedAt = Date.now();

  try {
    const ports = onlyValidPorts(req.body?.ports);
    const publicHost = String(req.body?.publicHost || req.body?.publicIp || '').trim();
    const timeoutMs = clampTimeout(req.body?.timeoutMs);

    if (!publicHost) {
      return res.status(400).json({
        ok: false,
        error: 'Falta publicHost o publicIp en el body.'
      });
    }

    const portChecks = [];

    for (const port of ports) {
      const [localInfo, publicInfo, localDynamic, publicDynamic] = await Promise.all([
        httpProbe(`http://127.0.0.1:${port}/info.json`, timeoutMs),
        httpProbe(`http://${publicHost}:${port}/info.json`, timeoutMs),
        httpProbe(`http://127.0.0.1:${port}/dynamic.json`, timeoutMs),
        httpProbe(`http://${publicHost}:${port}/dynamic.json`, timeoutMs)
      ]);

      portChecks.push(
        summarizePortProbe(port, localInfo, publicInfo, localDynamic, publicDynamic)
      );
    }

    const dockerPs = await getDockerPs();
    const containers = await getDockerContainersFromPsOutput(dockerPs.stdout);

    const [
      dockerPorts,
      udpInside,
      firewall,
      network,
      system
    ] = await Promise.all([
      getDockerPortMap(containers),
      getUdpListenersInsideContainers(containers, ports),
      getFirewallSnapshot(ports),
      getNetworkSnapshot(),
      getSystemSnapshot()
    ]);

    const globalStatus = portChecks.some((p) => p.status === 'critical')
      ? 'critical'
      : portChecks.some((p) => p.status === 'warning')
        ? 'warning'
        : 'ok';

    return res.json({
      ok: true,
      status: globalStatus,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      input: {
        publicHost,
        ports,
        timeoutMs
      },
      summary: {
        totalPorts: ports.length,
        ok: portChecks.filter((p) => p.status === 'ok').length,
        warning: portChecks.filter((p) => p.status === 'warning').length,
        critical: portChecks.filter((p) => p.status === 'critical').length
      },
      portChecks,
      docker: {
        ps: dockerPs,
        containers,
        ports: dockerPorts,
        udpInside
      },
      firewall,
      network,
      system
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message,
      durationMs: Date.now() - startedAt
    });
  }
});

router.get('/quick', async (req, res) => {
  try {
    const ports = onlyValidPorts(
      String(req.query.ports || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    );

    const publicHost = String(req.query.publicHost || req.query.publicIp || '').trim();

    if (!publicHost) {
      return res.status(400).json({
        ok: false,
        error: 'Falta publicHost o publicIp en query.'
      });
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

    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      publicHost,
      ports,
      results
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// 🚀 RUTAS DE DIAGNÓSTICO ADAPTATIVO Y REPORTES DE DESPLIEGUE (PDF/HTML)
router.get('/test-suite', async (_req, res) => {
  let result = getLatestTestResult();
  if (result.status === 'PENDING') {
    result = await runStagingHealthSuite('MANUAL_QUERY');
  }
  res.json(result);
});

router.post('/run-suite', async (_req, res) => {
  const result = await runStagingHealthSuite('MANUAL_TRIGGER');
  res.json(result);
});

router.get('/report-pdf', async (_req, res) => {
  let result = getLatestTestResult();
  if (result.status === 'PENDING') {
    result = await runStagingHealthSuite('PDF_REQUEST');
  }
  const html = generateReportHtml(result);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="ragenodes_deployment_report_${Date.now()}.html"`);
  res.send(html);
});

export default router;

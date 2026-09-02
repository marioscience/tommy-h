import http from 'node:http';
import net from 'node:net';
import dgram from 'node:dgram';
import { execFile } from 'node:child_process';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = path.join(root, 'results', stamp);
const proxies = {
  nginx: { httpPort: 18081, gamePort: 11001, container: 'proxy-bench-nginx' },
  oxide: { httpPort: 18082, gamePort: 11002, container: 'proxy-bench-oxide' },
};
const selectedProxy = ['nginx', 'oxide'].includes(process.env.BENCH_ONLY) ? process.env.BENCH_ONLY : null;
const settings = {
  rounds: Number(process.env.BENCH_ROUNDS || 3),
  httpRequests: Number(process.env.HTTP_REQUESTS || 30000),
  httpConcurrency: Number(process.env.HTTP_CONCURRENCY || 128),
  tcpMessages: Number(process.env.TCP_MESSAGES || 30000),
  tcpConnections: Number(process.env.TCP_CONNECTIONS || 128),
  udpMessages: Number(process.env.UDP_MESSAGES || 30000),
  udpWindow: Number(process.env.UDP_WINDOW || 128),
  udpTimeoutMs: Number(process.env.UDP_TIMEOUT_MS || 3000),
  startProxy: process.env.BENCH_START === 'oxide' ? 'oxide' : 'nginx',
};

const now = () => process.hrtime.bigint();
const ms = (start) => Number(now() - start) / 1e6;
const sleep = (n) => new Promise((resolve) => setTimeout(resolve, n));
function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}
function summarize(latencies, completed, errors, durationMs, extra = {}) {
  const sorted = latencies.sort((a, b) => a - b);
  return {
    attempted: completed + errors,
    completed,
    errors,
    duration_ms: Number(durationMs.toFixed(2)),
    throughput_per_sec: Number((completed / (durationMs / 1000)).toFixed(2)),
    latency_ms: {
      mean: sorted.length ? Number((sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(3)) : null,
      p50: percentile(sorted, 50) === null ? null : Number(percentile(sorted, 50).toFixed(3)),
      p95: percentile(sorted, 95) === null ? null : Number(percentile(sorted, 95).toFixed(3)),
      p99: percentile(sorted, 99) === null ? null : Number(percentile(sorted, 99).toFixed(3)),
      max: sorted.length ? Number(sorted.at(-1).toFixed(3)) : null,
    },
    ...extra,
  };
}

async function captureStats(container, stopSignal) {
  const samples = [];
  while (!stopSignal.stop) {
    try {
      const { stdout } = await execFileAsync('docker', ['stats', '--no-stream', '--format', '{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}', container]);
      const [cpu, memory, memoryPercent] = stdout.trim().split('|');
      samples.push({ cpu_percent: Number(cpu?.replace('%', '')), memory, memory_percent: Number(memoryPercent?.replace('%', '')) });
    } catch (error) {
      samples.push({ error: error.message });
    }
    await sleep(400);
  }
  const valid = samples.filter((x) => Number.isFinite(x.cpu_percent));
  return {
    samples,
    cpu_mean_percent: valid.length ? Number((valid.reduce((s, x) => s + x.cpu_percent, 0) / valid.length).toFixed(2)) : null,
    cpu_peak_percent: valid.length ? Math.max(...valid.map((x) => x.cpu_percent)) : null,
    memory_peak_percent: valid.length ? Math.max(...valid.map((x) => x.memory_percent)) : null,
  };
}

async function httpRun(port, count, concurrency) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
  const latencies = [];
  let next = 0, completed = 0, errors = 0;
  const started = now();
  async function worker() {
    while (true) {
      const id = next++;
      if (id >= count) return;
      const requestStart = now();
      await new Promise((resolve) => {
        const req = http.get({ hostname: '127.0.0.1', port, path: `/healthz?n=${id}`, agent, timeout: 3000 }, (res) => {
          res.resume();
          res.on('end', () => {
            if (res.statusCode === 200) { completed++; latencies.push(ms(requestStart)); } else errors++;
            resolve();
          });
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', () => { errors++; resolve(); });
      });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  agent.destroy();
  return summarize(latencies, completed, errors, ms(started));
}

async function tcpRun(port, count, connections) {
  const perConnection = Math.ceil(count / connections);
  const latencies = [];
  let completed = 0, errors = 0, issued = 0;
  const started = now();
  await Promise.all(Array.from({ length: connections }, () => new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let pendingAt = null, buffer = '', sent = 0;
    const send = () => {
      if (issued >= count || sent >= perConnection) return socket.end();
      issued++; sent++; pendingAt = now(); socket.write(`packet-${issued.toString().padStart(8, '0')}\n`);
    };
    socket.setTimeout(5000);
    socket.on('connect', send);
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      while (buffer.includes('\n')) {
        buffer = buffer.slice(buffer.indexOf('\n') + 1);
        completed++; latencies.push(ms(pendingAt)); send();
      }
    });
    socket.on('timeout', () => socket.destroy(new Error('timeout')));
    socket.on('error', () => { errors++; });
    socket.on('close', resolve);
  })));
  errors += Math.max(0, count - completed - errors);
  return summarize(latencies, completed, errors, ms(started));
}

async function udpRun(port, count, windowSize, timeoutMs) {
  const socket = dgram.createSocket('udp4');
  const pending = new Map();
  const latencies = [];
  let sent = 0, completed = 0, socketErrors = 0;
  const started = now();
  await new Promise((resolve) => {
    let finished = false;
    let timer;
    let hardTimer;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      clearTimeout(hardTimer);
      resolve();
    };
    const pump = () => {
      while (sent < count && pending.size < windowSize) {
        const id = ++sent;
        const payload = Buffer.from(`u${id.toString().padStart(11, '0')}`);
        pending.set(payload.toString(), now());
        socket.send(payload, port, '127.0.0.1', (error) => {
          if (error) { socketErrors++; pending.delete(payload.toString()); }
        });
      }
      if (completed === count) finish();
    };
    socket.on('message', (payload) => {
      const key = payload.toString();
      const requestStart = pending.get(key);
      if (requestStart) { pending.delete(key); completed++; latencies.push(ms(requestStart)); pump(); }
    });
    socket.on('error', () => { socketErrors++; });
    socket.bind(0, '127.0.0.1', pump);
    timer = setInterval(() => {
      const cutoff = now() - BigInt(timeoutMs) * 1000000n;
      for (const [key, requestStart] of pending) {
        if (requestStart < cutoff) pending.delete(key);
      }
      if (sent === count && pending.size === 0) finish(); else pump();
    }, 50);
    hardTimer = setTimeout(finish, Math.max(30000, Math.ceil(count / 1000) * 1000));
  });
  try { socket.close(); } catch {}
  const lost = count - completed;
  return summarize(latencies, completed, lost, ms(started), { lost, socket_errors: socketErrors, loss_percent: Number(((lost / count) * 100).toFixed(3)) });
}

async function metadata() {
  const safe = async (cmd, args) => { try { return (await execFileAsync(cmd, args)).stdout.trim(); } catch (e) { return e.message; } };
  return {
    generated_at: new Date().toISOString(), platform: process.platform, node: process.version,
    host: { cpus: os.cpus().length, cpu_model: os.cpus()[0]?.model, memory_gib: Number((os.totalmem() / 2 ** 30).toFixed(2)) },
    docker_server: await safe('docker', ['version', '--format', '{{.Server.Version}}']),
    images: {
      nginx: await safe('docker', ['inspect', '--format', '{{.Image}}', 'proxy-bench-nginx']),
      oxide: await safe('docker', ['inspect', '--format', '{{.Image}}', 'proxy-bench-oxide']),
    },
  };
}

await mkdir(outputDir, { recursive: true });
const results = { metadata: await metadata(), settings, rounds: [] };
for (let round = 1; round <= settings.rounds; round++) {
  const nginxFirst = settings.startProxy === 'nginx' ? round % 2 === 1 : round % 2 === 0;
  const order = selectedProxy ? [selectedProxy] : (nginxFirst ? ['nginx', 'oxide'] : ['oxide', 'nginx']);
  for (const name of order) {
    const proxy = proxies[name];
    await httpRun(proxy.httpPort, 2000, 64);
    await tcpRun(proxy.gamePort, 1000, 32);
    await udpRun(proxy.gamePort, 1000, 128, 1000);
    const entry = { round, proxy: name };
    const statsSignal = { stop: false };
    const statsPromise = captureStats(proxy.container, statsSignal);
    entry.http = await httpRun(proxy.httpPort, settings.httpRequests, settings.httpConcurrency);
    entry.tcp = await tcpRun(proxy.gamePort, settings.tcpMessages, settings.tcpConnections);
    entry.udp = await udpRun(proxy.gamePort, settings.udpMessages, settings.udpWindow, settings.udpTimeoutMs);
    statsSignal.stop = true;
    const resources = await statsPromise;
    entry.http.resources = resources;
    entry.tcp.resources = resources;
    entry.udp.resources = resources;
    results.rounds.push(entry);
    console.log(`round=${round} proxy=${name} http=${entry.http.throughput_per_sec}/s tcp=${entry.tcp.throughput_per_sec}/s udp=${entry.udp.throughput_per_sec}/s loss=${entry.udp.loss_percent}%`);
    await sleep(1000);
  }
}

function aggregate(proxy, protocol) {
  const rows = results.rounds.filter((r) => r.proxy === proxy).map((r) => r[protocol]);
  const avg = (field) => Number((rows.reduce((sum, row) => sum + field(row), 0) / rows.length).toFixed(2));
  return {
    throughput_per_sec: avg((x) => x.throughput_per_sec),
    p50_ms: avg((x) => x.latency_ms.p50), p95_ms: avg((x) => x.latency_ms.p95), p99_ms: avg((x) => x.latency_ms.p99),
    errors: rows.reduce((sum, x) => sum + x.errors, 0),
    cpu_mean_percent: avg((x) => x.resources.cpu_mean_percent || 0),
    cpu_peak_percent: Math.max(...rows.map((x) => x.resources.cpu_peak_percent || 0)),
    memory_peak_percent: Math.max(...rows.map((x) => x.resources.memory_peak_percent || 0)),
  };
}
results.summary = {};
for (const proxy of (selectedProxy ? [selectedProxy] : Object.keys(proxies))) {
  results.summary[proxy] = {};
  for (const protocol of ['http', 'tcp', 'udp']) results.summary[proxy][protocol] = aggregate(proxy, protocol);
}
await writeFile(path.join(outputDir, 'raw-results.json'), JSON.stringify(results, null, 2));
for (const file of ['nginx.conf', 'oxide_proxy.yml', 'compose.yml', 'runner.mjs']) await copyFile(path.join(root, file), path.join(outputDir, file));
const lines = ['# OxideProxy vs NGINX — benchmark local', '', `Fecha: ${results.metadata.generated_at}`, '', `Rondas: ${settings.rounds}. Carga medida por proxy: ${settings.httpRequests * settings.rounds} HTTP + ${settings.tcpMessages * settings.rounds} TCP + ${settings.udpMessages * settings.rounds} UDP.`, '', '| Proxy | Protocolo | ops/s | p50 ms | p95 ms | p99 ms | errores/pérdidas | CPU media | CPU pico | Memoria pico |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
for (const proxy of Object.keys(results.summary)) for (const protocol of ['http', 'tcp', 'udp']) {
  const x = results.summary[proxy][protocol];
  lines.push(`| ${proxy} | ${protocol.toUpperCase()} | ${x.throughput_per_sec} | ${x.p50_ms} | ${x.p95_ms} | ${x.p99_ms} | ${x.errors} | ${x.cpu_mean_percent}% | ${x.cpu_peak_percent}% | ${x.memory_peak_percent}% |`);
}
lines.push('', '## Alcance', '', '- Ambos proxies: 2 vCPU, 512 MiB, misma red Docker y mismo backend.', '- Orden alternado por ronda y calentamiento previo.', '- XDP/eBPF está desactivado: Docker Desktop no ofrece una comparación justa del camino XDP del kernel anfitrión.', '- Este resultado mide rendimiento local de proxy; no sustituye una prueba distribuida de Internet ni una prueba DDoS.', '');
await writeFile(path.join(outputDir, 'REPORT.md'), lines.join('\n'));
console.log(`RESULT_DIR=${outputDir}`);

// Standalone development fixture. Never imported by the production backend.
import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
if (process.env.RAGENODES_DEV_MOCK !== 'true') throw new Error('Requires explicit RAGENODES_DEV_MOCK=true');
const publicDir = await realpath(fileURLToPath(new URL('../../frontend/public', import.meta.url)));
const scenarios = new Set(['minecraft-running', 'node-full', 'node-offline', 'backup-failed']);
let scenario = 'minecraft-running';
const user = { id: '11111111-1111-4111-8111-111111111111', username: 'Desarrollo simulado', email: 'dev@example.invalid', role: 'user', plan: 'hobby', is_verified: true };
const item = { id: '22222222-2222-4222-8222-222222222222', owner_id: user.id, name: 'Minecraft SIMULADO', template: 'minecraft', status: 'running', plan: 'hobby', port: 25565, cpu: 1, ram: 1536, disk: 5, created_at: new Date().toISOString(), db_name: 'dev_fixture', db_user: 'dev_fixture', db_password: 'not-a-real-password', node_name: 'Nodo simulado', container_name: 'mock-only', memory_limit: 1536 };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
async function body(req) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > 65536) throw new Error('Body too large'); }
  return data ? JSON.parse(data) : {};
}
const server = http.createServer(async (req, res) => {
  const id = randomUUID();
  res.setHeader('X-Request-ID', id);
  res.setHeader('X-RageNodes-Simulation', 'true');
  res.setHeader('Cache-Control', 'no-store');
  res.on('finish', () => console.log(JSON.stringify({ id, method: req.method, path: req.url?.split('?')[0], status: res.statusCode, scenario })));
  const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (p === '/healthz') return json({ ok: true, simulated: true, scenario });
    if (p === '/__dev/scenario' && req.method === 'POST') {
      // Scenario control is for the container-local CLI, not cross-site requests.
      if (req.socket.remoteAddress !== '127.0.0.1' && req.socket.remoteAddress !== '::ffff:127.0.0.1' && req.socket.remoteAddress !== '::1') return json({ error: 'Container-local only' }, 403);
      const value = (await body(req)).scenario;
      if (!scenarios.has(value)) return json({ error: 'Unknown scenario' }, 400);
      scenario = value; item.status = value === 'node-offline' ? 'unknown' : 'running';
      return json({ scenario, simulated: true });
    }
    if (p === '/api/auth/me') return json(user);
    if (p === '/api/auth/login' && req.method === 'POST') return json({ user, simulated: true });
    if (p === '/api/servers' && req.method === 'GET') return json({ items: [item], publicHost: 'localhost' });
    if (p === '/api/servers' && req.method === 'POST') return json({ error: scenario === 'node-full' ? 'SIMULADO: no hay recursos disponibles' : 'SIMULADO: creación real requiere el entorno de integración' }, 400);
    if (p === `/api/servers/${item.id}`) return json({ item, publicHost: 'localhost' });
    if (p.endsWith('/stats-history')) return json({ items: [] });
    if (p.endsWith('/backups') && req.method === 'GET') return json({ items: [] });
    if (p.endsWith('/backup') && req.method === 'POST') return json({ error: scenario === 'backup-failed' ? 'SIMULADO: fallo al crear backup' : 'SIMULADO: copia real no disponible' }, 400);
    if (p.endsWith('/command') && req.method === 'POST') return json({ ok: true, simulated: true });
    if (/\/(start|stop|restart)$/.test(p) && req.method === 'POST') { item.status = p.endsWith('/stop') ? 'stopped' : 'running'; return json({ ok: true, simulated: true }); }
    if (p.endsWith('/logs/stream')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      const timer = setInterval(() => res.write(`data: ${JSON.stringify({ log: '[SIMULADO] Servidor activo' })}\n\n`), 2000);
      req.on('close', () => clearInterval(timer)); return;
    }
    if (p === '/api/notifications') return json({ items: [] });
    if (p.startsWith('/api/')) return json({ error: 'Ruta no implementada en el simulador', path: p, simulated: true }, 501);
    let relative = decodeURIComponent(p);
    if (relative === '/') relative = '/index.html';
    if (!path.extname(relative)) relative += '.html';
    const candidate = path.resolve(publicDir, '.' + relative);
    if (!candidate.startsWith(publicDir + path.sep)) return json({ error: 'Forbidden' }, 403);
    const real = await realpath(candidate);
    if (!real.startsWith(publicDir + path.sep)) return json({ error: 'Forbidden' }, 403);
    let content = await readFile(real);
    if (real.endsWith('.html')) content = Buffer.from(content.toString().replace(/<body([^>]*)>/i, '<body$1><div style="position:fixed;bottom:0;left:0;z-index:2147483647;background:#713f12;color:white;padding:6px">DESARROLLO SIMULADO — sin servidores ni datos reales</div>'));
    res.writeHead(200, { 'Content-Type': types[path.extname(real)] || 'application/octet-stream' }); res.end(content);
  } catch (error) { json({ error: error.code === 'ENOENT' ? 'Not found' : 'Invalid request' }, error.code === 'ENOENT' ? 404 : 400); }
});
server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log(`Frontend simulado disponible en :${server.address().port}/panel`));

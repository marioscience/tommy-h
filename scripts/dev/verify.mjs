import { spawnSync } from 'node:child_process';

function runDocker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `docker ${args.join(' ')} terminó con ${result.status}`);
  return result.stdout.trim();
}

async function requireHttp(url, label) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status} en ${url}`);
  return response.headers.get('content-type')?.includes('json') ? response.json() : response.text();
}

export async function verifyDevelopment({ composeArgs, env, mode = 'core' }) {
  const checks = [];
  const record = async (name, action) => {
    try {
      await action();
      checks.push({ name, status: 'pass' });
    } catch (error) {
      checks.push({ name, status: 'fail', detail: error.message });
    }
  };

  runDocker([...composeArgs, 'config', '--quiet']);
  const running = runDocker([...composeArgs, 'ps', '--services', '--filter', 'status=running']).split(/\r?\n/).filter(Boolean);
  const required = mode === 'frontend' ? ['frontend'] : ['backend', 'postgres', 'mariadb', 'redis'];
  for (const service of required) {
    await record(`contenedor ${service}`, async () => {
      if (!running.includes(service)) throw new Error('no está en ejecución');
    });
  }

  if (mode === 'frontend') {
    await record('frontend /healthz', () => requireHttp(`http://127.0.0.1:${env.DEV_FRONTEND_PORT || 18088}/healthz`, 'frontend'));
    await record('API simulada', async () => {
      const body = await requireHttp(`http://127.0.0.1:${env.DEV_FRONTEND_PORT || 18088}/api/auth/me`, 'mock auth');
      if (!body?.role) throw new Error('respuesta sin identidad simulada');
    });
  } else {
    const base = `http://127.0.0.1:${env.DEV_BACKEND_PORT || 13010}`;
    await record('backend /healthz', () => requireHttp(`${base}/healthz`, 'backend health'));
    await record('backend /readyz y migraciones', async () => {
      const body = await requireHttp(`${base}/readyz`, 'backend readiness');
      if (body?.status && !['ok', 'ready', 'healthy'].includes(body.status)) throw new Error(`estado ${body.status}`);
    });
    await record('PostgreSQL', async () => runDocker([...composeArgs, 'exec', '-T', 'postgres', 'pg_isready', '-U', 'ragenodes', '-d', 'ragenodes']));
    await record('Redis', async () => {
      if (runDocker([...composeArgs, 'exec', '-T', 'redis', 'redis-cli', 'ping']) !== 'PONG') throw new Error('Redis no respondió PONG');
    });
    await record('MariaDB', async () => runDocker([...composeArgs, 'exec', '-T', 'mariadb', 'healthcheck.sh', '--connect', '--innodb_initialized']));
  }

  const failed = checks.filter(check => check.status === 'fail');
  console.table(checks);
  if (failed.length) throw new Error(`Verificación fallida: ${failed.map(check => check.name).join(', ')}`);
  console.log(`Entorno ${mode} apto: ${checks.length}/${checks.length} comprobaciones superadas.`);
  return checks;
}

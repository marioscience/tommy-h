import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const envFile = path.join(root, '.env.development');
const groups = { frontend: ['frontend'], backend: ['backend'], core: ['backend'], data: ['postgres', 'mariadb', 'redis'], proxy: ['proxy'] };
const services = new Set(['frontend', 'backend', 'postgres', 'mariadb', 'redis', 'proxy']);
function envValue(name) {
  if (!existsSync(envFile)) return undefined;
  const match = readFileSync(envFile, 'utf8').match(new RegExp(`^${name}=([^\\r\\n]+)$`, 'm'));
  return match?.[1]?.trim();
}
function projectName() {
  const name = process.env.RAGENODES_DEV_PROJECT || envValue('DEV_PROJECT_NAME') || 'ragenodes-dev';
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
    throw new Error('DEV_PROJECT_NAME debe usar solo minúsculas, números, guion o guion bajo.');
  }
  return name;
}
function compose() {
  return ['compose', '--project-name', projectName(), '--env-file', envFile, '-f', 'compose.development.yml'];
}
function run(args, capture = false) {
  const r = spawnSync('docker', args, { stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(capture ? r.stderr : `Docker terminó con código ${r.status}`);
  return r.stdout;
}
function setup() {
  if (!existsSync(envFile)) {
    const secret = () => randomBytes(24).toString('hex');
    const localProject = `ragenodes-dev-${randomBytes(4).toString('hex')}`;
    writeFileSync(envFile, `DEV_PROJECT_NAME=${localProject}\nDEV_POSTGRES_PASSWORD=${secret()}\nDEV_MARIADB_PASSWORD=${secret()}\nDEV_JWT_SECRET=${secret()}\nDEV_ADMIN_PASSWORD=${secret()}\nDEV_FRONTEND_PORT=18088\nDEV_BACKEND_PORT=13010\nDEV_PROXY_PORT=18089\n`, { flag: 'wx', mode: 0o600 });
    console.log('Creado .env.development con credenciales locales. No se modifica .env.');
  } else console.log('Se conserva .env.development existente.');
  run([...compose(), 'config', '--quiet']);
}
function select(name, fallback = 'core') {
  const selected = groups[name || fallback];
  if (!selected) throw new Error(`Componente desconocido. Disponibles: ${Object.keys(groups).join(', ')}`);
  return selected;
}
try {
  const [command = 'help', name, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error('Argumentos adicionales no admitidos. Ejecuta ./dev help.');
  switch (command) {
    case 'setup': setup(); break;
    case 'doctor': {
      console.log(`Node ${process.version}; plataforma ${process.platform}; proyecto ${projectName()}`);
      console.log(run(['compose', 'version'], true).trim());
      console.log(run(['info', '--format', 'Docker: {{.ServerVersion}} | CPU: {{.NCPU}} | RAM bytes: {{.MemTotal}}'], true).trim());
      console.log(`DOCKER_HOST: ${process.env.DOCKER_HOST || 'contexto activo de Docker'}`);
      if (!existsSync(envFile)) throw new Error('Falta .env.development: ejecuta ./dev setup.');
      run([...compose(), 'config', '--quiet']);
      run([...compose(), 'ps', '--all']);
      console.log('Si un puerto está ocupado, cambia DEV_*_PORT en .env.development. Las imágenes internas se construyen desde código; no requieren docker login.');
      break;
    }
    case 'up': setup(); run([...compose(), 'up', '-d', '--build', '--wait', '--wait-timeout', '180', ...select(name)]); console.log('Listo. ./dev status muestra los puertos; ./dev logs backend muestra los logs. Frontend mock: /panel. API real: /login.'); break;
    case 'logs': if (name && name !== 'all' && !services.has(name)) throw new Error('Servicio desconocido'); run([...compose(), 'logs', '--tail', '100', '-f', ...(name && name !== 'all' ? [name] : [])]); break;
    case 'status': run([...compose(), 'ps', '--all']); break;
    case 'stop': run([...compose(), 'stop', ...(name ? select(name) : [])]); break;
    case 'down': run([...compose(), 'down']); break;
    case 'credentials': console.log('Administrador local: admin\nContraseña: consulta DEV_ADMIN_PASSWORD en .env.development. El frontend simulado usa una identidad ficticia automática.'); break;
    case 'scenario': {
      const allowed = ['minecraft-running', 'node-full', 'node-offline', 'backup-failed'];
      if (!allowed.includes(name)) throw new Error(`Escenarios: ${allowed.join(', ')}`);
      run([...compose(), 'exec', '-T', 'frontend', 'node', '-e', `fetch('http://127.0.0.1:8080/__dev/scenario',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario:process.argv[1]})}).then(async r=>{console.log(await r.text());if(!r.ok)process.exitCode=1}).catch(()=>process.exitCode=1)`, name]); break;
    }
    default: if (command !== 'help') throw new Error('Comando desconocido'); console.log('RageNodes local (Linux, WSL, Dev Container)\n./dev setup | doctor | up [frontend|backend|core|data|proxy]\n./dev logs [servicio|all] | status | stop [componente] | down | credentials\n./dev scenario minecraft-running|node-full|node-offline|backup-failed\nFrontend: simulación sin Docker socket. Core/backend: API real y BD, sin juegos.\nLos datos se conservan al detener. Integración completa: sigue README, con .env.local.example.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }

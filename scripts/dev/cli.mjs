import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gameSmokeMain, GAME_PROFILES } from './game-smoke.mjs';
import { verifyDevelopment } from './verify.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const envFile = path.join(root, '.env.development');
const releaseFile = path.join(root, 'deploy', 'registry-release.lock');
const groups = { frontend: ['frontend'], backend: ['backend'], core: ['backend'], data: ['postgres', 'mariadb', 'redis'], proxy: ['proxy'], prebuilt: ['proxy'] };
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
function compose(prebuilt = false) {
  const args = ['compose', '--project-name', projectName(), '--env-file', envFile];
  if (prebuilt) args.push('--env-file', releaseFile);
  args.push('-f', 'compose.development.yml');
  if (prebuilt) args.push('-f', 'compose.development.prebuilt.yml');
  return args;
}
function run(args, capture = false) {
  const r = spawnSync('docker', args, { stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(capture ? r.stderr : `Docker terminó con código ${r.status}`);
  return r.stdout;
}
function runProcess(command, args) {
  const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  const r = spawnSync(executable, args, { stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${command} terminó con código ${r.status}`);
}
function developmentEnvironment() {
  if (!existsSync(envFile)) return {};
  return Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/)
    .filter(line => /^[A-Z0-9_]+=/.test(line))
    .map(line => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
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
function releaseManifest() {
  if (!existsSync(releaseFile)) throw new Error('Falta deploy/registry-release.lock. Actualiza tu rama desde origin/dev.');
  const values = Object.fromEntries(readFileSync(releaseFile, 'utf8').split(/\r?\n/).filter(line => /^[A-Z0-9_]+=/.test(line)).map(line => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  const expected = {
    RAGENODES_BACKEND_IMAGE: 'backend',
    RAGENODES_BOT_IMAGE: 'bot',
    RAGENODES_OXIDEPROXY_IMAGE: 'oxideproxy',
    RAGENODES_OXIDE_CONTROL_PANEL_IMAGE: 'oxide-control-panel'
  };
  for (const [variable, component] of Object.entries(expected)) {
    const pattern = new RegExp(`^registry\\.gitlab\\.com/mariomatos/ragenodesultimate/${component}@sha256:[0-9a-f]{64}$`);
    if (!pattern.test(values[variable] || '')) throw new Error(`Referencia inmutable inválida: ${variable}`);
  }
  if (!/^[0-9a-f]{40}$/.test(values.RAGENODES_RELEASE_REVISION || '')) throw new Error('Revisión inválida en deploy/registry-release.lock.');
  return values;
}
function pullPrebuilt() {
  setup();
  const manifest = releaseManifest();
  run([...compose(true), 'config', '--quiet']);
  run([...compose(true), 'pull', 'backend', 'proxy']);
  for (const variable of ['RAGENODES_BACKEND_IMAGE', 'RAGENODES_OXIDEPROXY_IMAGE']) {
    const revision = run(['image', 'inspect', '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}', manifest[variable]], true).trim();
    if (revision !== manifest.RAGENODES_RELEASE_REVISION) {
      throw new Error(`${variable} pertenece a ${revision || 'una revisión sin etiqueta'}, no a ${manifest.RAGENODES_RELEASE_REVISION}.`);
    }
  }
  console.log(`Imágenes de dev verificadas: ${manifest.RAGENODES_RELEASE_REVISION.slice(0, 12)}.`);
}
function select(name, fallback = 'core') {
  const selected = groups[name || fallback];
  if (!selected) throw new Error(`Componente desconocido. Disponibles: ${Object.keys(groups).join(', ')}`);
  return selected;
}
try {
  const [command = 'help', name, ...extra] = process.argv.slice(2);
  if (extra.length && command !== 'clean') throw new Error('Argumentos adicionales no admitidos. Ejecuta ./dev help.');
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
    case 'pull':
      if (name && name !== 'prebuilt') throw new Error('Usa ./dev pull o ./dev pull prebuilt.');
      pullPrebuilt();
      break;
    case 'start':
    case 'up': {
      const prebuilt = name === 'prebuilt';
      if (prebuilt) pullPrebuilt(); else setup();
      const buildArgs = prebuilt ? [] : ['--build'];
      run([...compose(prebuilt), 'up', '-d', ...buildArgs, '--wait', '--wait-timeout', '180', ...select(name)]);
      console.log(prebuilt ? 'Listo con imágenes verificadas de dev y código local montado. Edita backend/src o frontend/public sin recompilar.' : 'Listo. ./dev status muestra los puertos; ./dev logs backend muestra los logs. Frontend mock: /panel. API real: /login.');
      break;
    }
    case 'logs': if (name && name !== 'all' && !services.has(name)) throw new Error('Servicio desconocido'); run([...compose(), 'logs', '--tail', '100', '-f', ...(name && name !== 'all' ? [name] : [])]); break;
    case 'status': run([...compose(), 'ps', '--all']); break;
    case 'test':
      runProcess(process.execPath, ['scripts/dev/quality-gate.mjs', name || 'all']);
      break;
    case 'verify': {
      setup();
      const mode = name || 'core';
      if (!['frontend', 'core'].includes(mode)) throw new Error('Usa ./dev verify frontend o ./dev verify core.');
      await verifyDevelopment({ composeArgs: compose(), env: developmentEnvironment(), mode });
      break;
    }
    case 'game-smoke':
      if (!name) throw new Error(`Indica un juego: ${Object.keys(GAME_PROFILES).join(', ')}`);
      await gameSmokeMain(name);
      break;
    case 'stop': run([...compose(), 'stop', ...(name ? select(name) : [])]); break;
    case 'down': run([...compose(), 'down']); break;
    case 'clean':
      if (name !== '--confirm' || extra.length) {
        throw new Error('Esta acción borra los datos locales. Confirma explícitamente con ./dev clean --confirm');
      }
      run([...compose(), 'down', '--volumes', '--remove-orphans']);
      console.log(`Datos locales de ${projectName()} eliminados. .env.development se conserva.`);
      break;
    case 'credentials': console.log('Administrador local: admin\nContraseña: consulta DEV_ADMIN_PASSWORD en .env.development. El frontend simulado usa una identidad ficticia automática.'); break;
    case 'scenario': {
      const allowed = ['minecraft-running', 'node-full', 'node-offline', 'backup-failed'];
      if (!allowed.includes(name)) throw new Error(`Escenarios: ${allowed.join(', ')}`);
      run([...compose(), 'exec', '-T', 'frontend', 'node', '-e', `fetch('http://127.0.0.1:8080/__dev/scenario',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario:process.argv[1]})}).then(async r=>{console.log(await r.text());if(!r.ok)process.exitCode=1}).catch(()=>process.exitCode=1)`, name]); break;
    }
    default: if (command !== 'help') throw new Error('Comando desconocido'); console.log('RageNodes local (Linux, WSL, Dev Container)\n./dev setup | doctor | pull [prebuilt] | up/start [prebuilt|frontend|backend|core|data|proxy]\n./dev test [all|frontend|backend|proxy] | verify [frontend|core]\n./dev game-smoke <juego> (configura GAME_SMOKE_HOST y puertos opcionales)\n./dev logs [servicio|all] | status | stop [componente] | down | clean --confirm | credentials\n./dev scenario minecraft-running|node-full|node-offline|backup-failed\nPrebuilt: imágenes verificadas de dev con backend/src y frontend/public locales.\nFrontend: simulación sin Docker socket. Core/backend: API real y BD, sin juegos.\nLos datos se conservan al detener; clean es la única acción que elimina volúmenes.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }

import fs from 'node:fs/promises';

const files = Object.fromEntries(await Promise.all([
  'docker-compose.yml',
  'docker-compose.staging.yml',
  'docker-compose.backup-remote.yml',
  'backend/Dockerfile',
  'oxideproxy/Dockerfile',
  '.env.example',
  'scripts/security/production_preflight.sh'
].map(async (file) => [file, await fs.readFile(file, 'utf8')])));

let failures = 0;
function assert(condition, message) {
  if (condition) console.log(`PASS ${message}`);
  else {
    failures += 1;
    console.error(`FAIL ${message}`);
  }
}

for (const composeFile of ['docker-compose.yml', 'docker-compose.staging.yml']) {
  const compose = files[composeFile];
  assert(compose.includes('${FRONTEND_BIND_IP:-127.0.0.1}'), `${composeFile} keeps auxiliary HTTP on loopback by default`);
  assert(!compose.includes('./rclone.conf:'), `${composeFile} cannot turn a missing rclone file into a directory`);
  assert(compose.includes('pids_limit:'), `${composeFile} defines process limits`);
  assert(compose.includes('read_only: true'), `${composeFile} defines read-only service filesystems`);
}

assert(/bot:[\s\S]*?env_file:\s*\[\s*"\$\{RAGENODES_ENV_FILE:-\.env\}"\s*\]/.test(files['docker-compose.yml']), 'Discord bot receives its environment contract');
assert(files['backend/Dockerfile'].includes('USER node'), 'backend image runs as a non-root user');
assert(files['backend/Dockerfile'].includes('AS backup-remote'), 'rclone is isolated in an optional backup runtime');
assert(!/RUN apk add[^\n]*rclone/.test(files['backend/Dockerfile'].split('AS backup-remote')[0]), 'default backend runtime excludes rclone');
assert(files['docker-compose.backup-remote.yml'].includes('target: backup-remote'), 'remote backup overlay selects the isolated rclone runtime');
assert(files['oxideproxy/Dockerfile'].includes('USER 65532:65532'), 'OxideProxy image runs as a non-root user');
assert(files['.env.example'].includes('DOCKER_SOCKET=/run/user/1000/docker.sock'), 'production example uses a rootless Docker socket');
assert(files['.env.example'].includes('ALLOW_ROOTFUL_DOCKER_SOCKET=false'), 'rootful Docker exception is disabled by default');
assert(files['.env.example'].includes('FRONTEND_BIND_IP=127.0.0.1'), 'auxiliary frontend bind is explicitly loopback-only');
assert(files['.env.example'].includes('DISCORD_API_KEY=') && files['.env.example'].includes('NODE_ENROLLMENT_API_KEY='), 'Discord and node enrollment use separate credentials');
assert(files['scripts/security/production_preflight.sh'].includes('rootless'), 'production preflight enforces rootless Docker');
assert(files['scripts/security/production_preflight.sh'].includes('sport = :111'), 'production preflight rejects an unexpected RPC portmapper');

if (failures) {
  console.error(`Deployment security contract failed: ${failures} finding(s).`);
  process.exit(1);
}

console.log('Deployment security contract passed.');

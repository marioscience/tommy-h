import fs from 'node:fs/promises';

const files = Object.fromEntries(await Promise.all([
  'docker-compose.yml',
  'docker-compose.staging.yml',
  'docker-compose.backup-remote.yml',
  'backend/Dockerfile',
  'oxideproxy/Dockerfile',
  '.env.example',
  'deploy.sh',
  'deploy_staging.sh',
  'backend/src/services/dockerService.js',
  'scripts/ensure_base_images.sh',
  'scripts/load_env.sh',
  'scripts/security/production_preflight.sh',
  'scripts/security/install_rootless_delegation.sh',
  'ops/systemd/ragenodes-rootless-delegation.conf'
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
  assert(compose.includes('./oxideproxy/config/oxide_proxy.yml:/app/config/oxide_proxy.yml:ro'), `${composeFile} preserves the certificates embedded in the proxy image`);
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
assert(files['scripts/security/production_preflight.sh'].includes("'{{json .Warnings}}'"), 'production preflight inspects Docker resource-controller warnings');
assert(files['scripts/security/production_preflight.sh'].includes('no cpu cfs quota support'), 'production preflight rejects missing CPU quota delegation');
assert(files['scripts/security/production_preflight.sh'].includes('no memory limit support'), 'production preflight rejects missing memory limits');
assert(files['scripts/security/production_preflight.sh'].includes('no pids limit support'), 'production preflight rejects missing process limits');
assert(files['scripts/security/production_preflight.sh'].includes('sport = :111'), 'production preflight rejects an unexpected RPC portmapper');
assert(files['scripts/security/production_preflight.sh'].includes('load_env_file "$ENV_FILE"'), 'production preflight loads dotenv without executing it as shell code');
assert(!files['scripts/security/production_preflight.sh'].includes('source "$ENV_FILE"'), 'production preflight never sources dotenv content directly');
assert(files['ops/systemd/ragenodes-rootless-delegation.conf'].includes('Delegate=cpu cpuset io memory pids'), 'systemd template delegates every required rootless controller');
assert(files['scripts/security/install_rootless_delegation.sh'].includes('user@${target_uid}.service.d'), 'delegation installer scopes its override to the application UID');
assert(files['scripts/security/install_rootless_delegation.sh'].includes('systemctl daemon-reload'), 'delegation installer reloads systemd safely');
assert(files['scripts/load_env.sh'].includes("line=\"${line%$'\\r'}\""), 'dotenv loader accepts Windows line endings');
assert(files['scripts/ensure_base_images.sh'].includes('${FIVEM_BASE_IMAGE:?'), 'base-image preflight requires the configured FiveM image tag');
assert(files['scripts/ensure_base_images.sh'].includes('${BLENDER_BASE_IMAGE:?'), 'base-image preflight requires the configured Blender image tag');
assert(files['scripts/ensure_base_images.sh'].includes('${DOCKER_SOCKET:?'), 'base-image preflight requires the hardened runtime socket');
assert(files['scripts/ensure_base_images.sh'].includes('RUNTIME_DOCKER_HOST="unix://$DOCKER_SOCKET"'), 'base-image preflight targets the runtime daemon explicitly');
assert(files['scripts/ensure_base_images.sh'].includes('docker --host "$RUNTIME_DOCKER_HOST" build --tag "$image" "$context"'), 'base-image preflight builds the exact configured tags in the runtime daemon');
assert(files['scripts/ensure_base_images.sh'].includes('docker --host "$RUNTIME_DOCKER_HOST" image inspect "$image"'), 'base-image preflight verifies every resulting image in the runtime daemon');
assert(files['scripts/ensure_base_images.sh'].includes('network inspect "$RUNTIME_DOCKER_NETWORK"'), 'runtime network is verified in the rootless daemon');
assert(files['scripts/ensure_base_images.sh'].includes('network create "$RUNTIME_DOCKER_NETWORK"'), 'missing runtime network is created in the rootless daemon');
assert(files['deploy_staging.sh'].includes('RUNTIME_DOCKER_NETWORK=ragenodes_net_staging'), 'staging prepares its isolated rootless network');
assert(files['backend/src/services/dockerService.js'].includes('[config.dockerNetwork]: {}'), 'Blender joins the configured runtime network');
assert(!files['backend/src/services/dockerService.js'].includes("'ragenodes_net': {}"), 'Blender does not hardcode the production network');
for (const deployFile of ['deploy.sh', 'deploy_staging.sh']) {
  const deploy = files[deployFile];
  assert(deploy.includes('bash ./scripts/ensure_base_images.sh'), `${deployFile} prepares game images before application services`);
  assert(deploy.indexOf('bash ./scripts/ensure_base_images.sh') < deploy.indexOf('build "${APP_SERVICES[@]}"'), `${deployFile} cannot publish a backend before its game images exist`);
  assert(deploy.includes('wait_for_http()'), `${deployFile} waits for HTTP readiness instead of checking only once`);
  assert(/wait_for_http http:\/\/127\.0\.0\.1:\d+\/healthz 90/.test(deploy), `${deployFile} retries the health endpoint during startup`);
  assert(/wait_for_http http:\/\/127\.0\.0\.1:\d+\/readyz 90/.test(deploy), `${deployFile} retries the readiness endpoint during startup`);
}

if (failures) {
  console.error(`Deployment security contract failed: ${failures} finding(s).`);
  process.exit(1);
}

console.log('Deployment security contract passed.');

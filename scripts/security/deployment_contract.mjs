import fs from 'node:fs/promises';

const files = Object.fromEntries(await Promise.all([
  'docker-compose.yml',
  'docker-compose.staging.yml',
  'docker-compose.backup-remote.yml',
  'backend/Dockerfile',
  'fivem-base/Dockerfile',
  'oxideproxy/Dockerfile',
  '.env.example',
  'deploy.sh',
  'deploy_staging.sh',
  'backend/src/services/dockerService.js',
  'backend/src/services/dockerUtils.js',
  'backend/src/routes/discord.js',
  'backend/src/services/games/minecraft.js',
  'backend/src/services/games/rust.js',
  'backend/src/services/games/cs2.js',
  'backend/src/services/games/valheim.js',
  'oxideproxy/config/oxide_proxy.yml',
  'oxideproxy/src/config.rs',
  'oxideproxy/src/pipeline/mod.rs',
  'oxideproxy/src/pipeline/http_server.rs',
  'oxideproxy/node_panel/server.js',
  'scripts/ensure_base_images.sh',
  'scripts/update_image_cache.sh',
  'scripts/load_env.sh',
  'scripts/security/production_preflight.sh',
  'scripts/security/install_rootless_delegation.sh',
  'ops/systemd/ragenodes-rootless-delegation.conf',
  'ops/systemd/ragenodes-image-cache.service',
  'ops/systemd/ragenodes-image-cache.timer'
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
assert(files['oxideproxy/config/oxide_proxy.yml'].includes('game_servers: []'), 'OxideProxy active config starts without laboratory routes');
assert(!files['oxideproxy/config/oxide_proxy.yml'].includes('10.5.0.10:9001'), 'OxideProxy active config excludes mock game backends');
assert(files['oxideproxy/config/oxide_proxy.yml'].includes('default_web_backend: backend:3006'), 'OxideProxy resolves the portable backend network alias');
assert(files['oxideproxy/src/config.rs'].includes('ProxyConfig::load') || files['oxideproxy/src/config.rs'].includes('pub fn load('), 'OxideProxy exposes a fallible configuration loader');
assert(!files['oxideproxy/src/config.rs'].includes('pub fn load_or_default'), 'OxideProxy cannot silently fall back after a configuration error');
const proxyPipeline = files['oxideproxy/src/pipeline/mod.rs'];
const dedicatedTcpRoute = proxyPipeline.indexOf('if let Some(backend_addr) = specific_backend');
const tlsDetection = proxyPipeline.indexOf("buffer[0] == 0x16");
const proprietaryPacketParsing = proxyPipeline.indexOf('parse_game_packet(&buffer)');
assert(dedicatedTcpRoute !== -1 && tlsDetection !== -1 && dedicatedTcpRoute < tlsDetection, 'dedicated game TCP routes bypass TLS termination');
assert(tlsDetection < proprietaryPacketParsing, 'shared TCP ingress identifies TLS before proprietary game packets');
assert(proxyPipeline.includes('forward_udp(socket, payload, peer_addr, &backend_addr).await'), 'dedicated game UDP routes remain transparent datagrams');
assert((files['oxideproxy/src/pipeline/http_server.rs'].match(/"keep-alive"/g) || []).length >= 2, 'reverse proxy strips HTTP/2 hop-by-hop headers in both directions');
assert(!files['oxideproxy/node_panel/server.js'].includes("health: hasActivity ? 'HEALTHY"), 'Oxide control panel does not fabricate backend health');
assert(files['oxideproxy/node_panel/server.js'].includes("health: 'UNVERIFIED'"), 'Oxide control panel labels unprobed backends explicitly');
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
assert(files['scripts/ensure_base_images.sh'].includes('docker_runtime build'), 'base-image updater builds through the configured runtime daemon');
assert(files['scripts/ensure_base_images.sh'].includes("python3 -c 'import json, sys;"), 'FiveM metadata is parsed without an extra host package');
assert(files['scripts/ensure_base_images.sh'].includes('docker_runtime image inspect "$FIVEM_BASE_IMAGE" "$BLENDER_BASE_IMAGE"'), 'base-image updater verifies the promoted master aliases');
assert(files['scripts/ensure_base_images.sh'].includes('org.ragenodes.fivem.artifact'), 'FiveM rebuilds only when the recommended artifact changes');
assert(files['scripts/ensure_base_images.sh'].includes('docker_runtime save "$image"'), 'base images are archived in the local master cache');
assert(files['scripts/ensure_base_images.sh'].includes('docker_runtime pull "$image"'), 'digest-pinned external images are prefetched automatically');
assert(files['scripts/ensure_base_images.sh'].includes('MINECRAFT_BASE_IMAGE:=itzg/minecraft-server:java25@sha256:'), 'image cache has a digest-pinned default manifest');
assert(files['scripts/update_image_cache.sh'].includes('load_env_file "$ENV_FILE"'), 'scheduled image refresh loads dotenv without executing it');
assert(files['ops/systemd/ragenodes-image-cache.timer'].includes('Persistent=true'), 'missed image refreshes run after the host returns');
assert(files['ops/systemd/ragenodes-image-cache.service'].includes('NoNewPrivileges=true'), 'scheduled image refresh cannot gain privileges');
assert(files['ops/systemd/ragenodes-image-cache.service'].includes('ProtectSystem=strict'), 'scheduled image refresh has a read-only system view');
assert(files['fivem-base/Dockerfile'].includes('ARG FIVEM_DOWNLOAD_URL'), 'FiveM artifact selection is supplied explicitly at build time');
assert(files['fivem-base/Dockerfile'].includes('https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/*'), 'FiveM downloads are restricted to the vendor artifact origin');
assert(files['scripts/ensure_base_images.sh'].includes('network inspect "$RUNTIME_DOCKER_NETWORK"'), 'runtime network is verified in the rootless daemon');
assert(files['scripts/ensure_base_images.sh'].includes('network create "$RUNTIME_DOCKER_NETWORK"'), 'missing runtime network is created in the rootless daemon');
assert(files['deploy_staging.sh'].includes('RUNTIME_DOCKER_NETWORK=ragenodes_net_staging'), 'staging prepares its isolated rootless network');
assert(files['docker-compose.staging.yml'].match(/PORT_BASE_OFFSET(?::|=)\s*\$\{STAGING_PORT_BASE_OFFSET:-1000\}/g)?.length === 2, 'staging backend and worker share a configurable non-overlapping port offset');
const stagingControlPanelOverride = files['docker-compose.staging.yml'].match(/\n  oxide_control_panel:\n([\s\S]*?)(?=\n  oxide_game_staging:)/)?.[1] || '';
assert(!stagingControlPanelOverride.includes('security_opt:'), 'staging does not duplicate inherited control-panel security options');
assert(!stagingControlPanelOverride.includes('cap_drop:'), 'staging does not duplicate inherited control-panel capability drops');
assert(files['docker-compose.yml'].includes('network_mode: host'), 'Oxide Game can bind active public game ports without broad Docker ranges');
assert(files['docker-compose.staging.yml'].includes('OXIDE_GAME_PROXY_ENABLED: ${OXIDE_GAME_PROXY_ENABLED:-false}'), 'staging game proxy migration remains opt-in');
assert(files['backend/src/routes/discord.js'].includes("ragenodes.game_proxy'] !== 'enabled'"), 'route inventory excludes containers that still occupy public ports');
assert(!files['oxideproxy/node_panel/server.js'].includes('baseConns ='), 'Oxide telemetry never fabricates active players');
assert(files['.env.example'].includes('STAGING_PORT_BASE_OFFSET=1000'), 'staging example avoids aliasing production service port bands');
assert(files['docker-compose.yml'].includes('STAGING_TLS_UPSTREAM=${STAGING_TLS_UPSTREAM:-}'), 'production edge exposes an explicit staging TLS passthrough target');
assert(files['docker-compose.yml'].includes('STAGING_TLS_DOMAINS=${STAGING_TLS_DOMAINS:-ragenodes.dev}'), 'staging TLS passthrough is restricted to the staging domain');
assert(files['oxideproxy/src/pipeline/mod.rs'].includes('staging_tls_passthrough(&buffer)'), 'TLS ClientHello is routed by SNI before production termination');
const stagingLoadEnv = files['deploy_staging.sh'].indexOf('load_env_file');
const stagingPreflight = files['deploy_staging.sh'].indexOf('production_preflight.sh');
assert(stagingLoadEnv !== -1 && stagingPreflight !== -1 && stagingLoadEnv < stagingPreflight, 'staging loads dotenv before production preflight');
assert(files['.env.example'].includes('PORT_BIND_RETRY_LIMIT=8'), 'port binding retries are explicitly documented');
assert(files['backend/src/services/dockerService.js'].includes('[config.dockerNetwork]: {}'), 'Blender joins the configured runtime network');
assert(!files['backend/src/services/dockerService.js'].includes("'ragenodes_net': {}"), 'Blender does not hardcode the production network');
assert(files['backend/src/services/dockerUtils.js'].includes('deriveServiceIdentifier'), 'game instances can derive stable unique identifiers');
assert(files['backend/src/services/games/minecraft.js'].includes("DIFFICULTY=${opts.difficulty || 'normal'}"), 'Minecraft defaults to normal difficulty');
assert(files['backend/src/services/games/minecraft.js'].includes("'ONLINE_MODE=TRUE'"), 'Minecraft identity verification is enabled by default');
assert(files['backend/src/services/games/rust.js'].includes("deriveServiceIdentifier('rust'"), 'Rust identity is unique per server');
assert(files['backend/src/services/games/cs2.js'].includes("'SRCDS_TICKRATE=64'"), 'CS2 uses the standard beginner-friendly tickrate');
assert(files['backend/src/services/games/valheim.js'].includes("deriveServiceIdentifier('world'"), 'Valheim world names are unique per server');
for (const deployFile of ['deploy.sh', 'deploy_staging.sh']) {
  const deploy = files[deployFile];
  const redisService = deployFile === 'deploy.sh' ? 'redis' : 'redis-staging';
  assert(deploy.includes('bash ./scripts/ensure_base_images.sh'), `${deployFile} prepares game images before application services`);
  assert(deploy.indexOf('bash ./scripts/ensure_base_images.sh') < deploy.indexOf('build "${APP_SERVICES[@]}"'), `${deployFile} cannot publish a backend before its game images exist`);
  assert(deploy.includes(`STATE_SERVICES=(\n  ${redisService}\n)`), `${deployFile} declares Redis as required deployment state`);
  assert(deploy.indexOf('up -d "${STATE_SERVICES[@]}"') < deploy.indexOf('up -d --no-deps "${APP_SERVICES[@]}"'), `${deployFile} applies Redis configuration before application services`);
  assert(deploy.includes(`wait_for_service ${redisService} 60`), `${deployFile} waits for Redis readiness before application startup`);
  assert(deploy.includes('wait_for_http()'), `${deployFile} waits for HTTP readiness instead of checking only once`);
  assert(/wait_for_http http:\/\/127\.0\.0\.1:\d+\/healthz 90/.test(deploy), `${deployFile} retries the health endpoint during startup`);
  assert(/wait_for_http http:\/\/127\.0\.0\.1:\d+\/readyz 90/.test(deploy), `${deployFile} retries the readiness endpoint during startup`);
}

if (failures) {
  console.error(`Deployment security contract failed: ${failures} finding(s).`);
  process.exit(1);
}

console.log('Deployment security contract passed.');

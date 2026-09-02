import fs from 'node:fs/promises';

const files = Object.fromEntries(await Promise.all([
  'docker-compose.yml',
  'docker-compose.staging.yml',
  'docker-compose.registry.staging.yml',
  'docker-compose.backup-remote.yml',
  'backend/Dockerfile',
  'fivem-base/Dockerfile',
  'oxideproxy/Dockerfile',
  'oxideproxy/ebpf/src/main.rs',
  'oxideproxy/src/ebpf_xdp.rs',
  '.env.example',
  'deploy.sh',
  'deploy_staging.sh',
  'auto_update_prod.sh',
  'auto_update_staging.sh',
  'backend/src/services/dockerService.js',
  'backend/src/services/dockerUtils.js',
  'backend/src/services/backupService.js',
  'backend/src/services/serverControlService.js',
  'backend/src/routes/discord.js',
  'backend/src/services/games/minecraft.js',
  'backend/src/services/games/rust.js',
  'backend/src/services/games/cs2.js',
  'backend/src/services/games/valheim.js',
  'oxideproxy/config/oxide_proxy.yml',
  'oxideproxy/game_config/oxide_proxy.yml',
  'oxide_web/config/oxide_proxy.yml',
  'oxideproxy/src/config.rs',
  'oxideproxy/src/access_gate.rs',
  'oxideproxy/src/pipeline/mod.rs',
  'oxideproxy/src/pipeline/http_server.rs',
  'oxideproxy/node_panel/server.js',
  'oxideproxy/node_panel/Dockerfile',
  'oxideproxy/node_panel/routeReconciliation.js',
  'oxideproxy/node_panel/public/app.js',
  'frontend/public/js/panel.js',
  'frontend/public/games/fivem.html',
  'frontend/public/games/fivem_v3.html',
  'scripts/ensure_base_images.sh',
  'scripts/update_image_cache.sh',
  'scripts/registry/prepare_runtime_images.sh',
  'scripts/registry/build_and_push_kaniko.sh',
  'deploy/registry-release.lock',
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

assert(
  files['oxideproxy/node_panel/Dockerfile'].includes('COPY --chown=node:node routeReconciliation.js ./'),
  'Oxide control-panel image includes the route reconciliation runtime module'
);

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
assert(files['oxideproxy/Dockerfile'].includes('/app/oxide-ebpf.o'), 'OxideProxy image embeds the compiled XDP object');
assert(files['oxideproxy/Dockerfile'].includes('RUST_NIGHTLY_TOOLCHAIN=nightly-2026-08-29'), 'OxideProxy pins its eBPF Rust nightly for reproducible builds');
assert(files['oxideproxy/Dockerfile'].includes('while ! RUSTUP_MAX_RETRIES=5 rustup toolchain install'), 'OxideProxy retries interrupted Rust toolchain downloads');
assert(files['oxideproxy/Dockerfile'].includes('--retry 5 --retry-all-errors'), 'OxideProxy retries verified bpf-linker downloads');
assert(files['oxideproxy/ebpf/src/main.rs'].includes('#[xdp]') && files['oxideproxy/ebpf/src/main.rs'].includes('XDP_DROP'), 'OxideProxy implements a real kernel XDP program');
assert(files['oxideproxy/src/ebpf_xdp.rs'].includes('Ebpf::load_file') && files['oxideproxy/src/ebpf_xdp.rs'].includes('program.attach'), 'OxideProxy loads and attaches XDP instead of simulating it');
assert(files['oxideproxy/config/oxide_proxy.yml'].includes('game_servers: []'), 'OxideProxy active config starts without laboratory routes');
for (const configFile of ['oxideproxy/config/oxide_proxy.yml', 'oxideproxy/game_config/oxide_proxy.yml', 'oxide_web/config/oxide_proxy.yml']) {
  const config = files[configFile];
  assert(/enable_core_pinning:\s*true/.test(config), `${configFile} enables CPU affinity by default`);
  assert(/ebpf_xdp:\s*\n\s*enabled:\s*true/.test(config), `${configFile} enables in-memory L4 mitigation by default`);
  assert(/blacklist_enabled:\s*true/.test(config), `${configFile} enables blacklist enforcement by default`);
}
assert(files['oxideproxy/node_panel/public/app.js'].includes('JSON.stringify({ ebpf_xdp, security, runtime })'), 'Firewall controls persist the CPU affinity toggle');
assert(files['oxideproxy/node_panel/public/app.js'].includes('enabled: true'), 'Applying firewall controls enables the in-memory L4 mitigation engine');
assert(files['oxideproxy/node_panel/server.js'].includes("typeof runtime.enable_core_pinning === 'boolean'"), 'Oxide control plane validates and stores CPU affinity');
assert(files['oxideproxy/src/pipeline/http_server.rs'].includes('internal_frame_sources') && files['oxideproxy/src/pipeline/http_server.rs'].includes('https://*.ragenodes.com'), 'panel CSP permits both RageNodes apex domains and their subdomains');
assert(files['oxideproxy/src/config.rs'].includes('default_allowed_frame_origins') && files['oxideproxy/src/config.rs'].includes('https://idms.fivem.net'), 'panel CSP permits the official FiveM identity provider through validated runtime configuration');
assert(files['oxideproxy/node_panel/server.js'].includes('normalizeAllowedFrameOrigins') && files['oxideproxy/node_panel/server.js'].includes('/api/oxide/config/apply'), 'Oxide control plane validates and applies frame origins without rebuilding images');
assert(files['frontend/public/js/panel.js'].includes('window._downloadInterval = setInterval'), 'panel owns a single cancellable download-status poller');
assert(files['frontend/public/js/panel.js'].includes('downloadPollingUnavailable') && files['frontend/public/js/panel.js'].includes('res.status === 404'), 'panel backs off when a server leaves the current file-access scope');
assert(!/if \(popup\.closed\) \{[\s\S]{0,500}hideAuthOverlay\(\)/.test(files['frontend/public/js/panel.js']), 'closing the FiveM popup cannot mark an incomplete OAuth flow as linked');
for (const template of ['frontend/public/games/fivem.html', 'frontend/public/games/fivem_v3.html']) {
  assert(!/<iframe[^>]+id=["']txadmin-iframe["']/i.test(files[template]), `${template} cannot embed txAdmin in an iframe`);
  assert(files[template].includes('txAdmin se abre en una pestaña independiente'), `${template} explains the independent txAdmin tab`);
  assert(files[template].includes('Completé toda la autorización'), `${template} waits for the complete FiveM authorization flow`);
  assert(files[template].includes('contraseña de respaldo'), `${template} documents the optional FiveM backup-password step`);
}
assert(!files['oxideproxy/config/oxide_proxy.yml'].includes('10.5.0.10:9001'), 'OxideProxy active config excludes mock game backends');
assert(files['oxideproxy/config/oxide_proxy.yml'].includes('default_web_backend: backend:3006'), 'OxideProxy resolves the portable backend network alias');
assert(files['oxideproxy/src/config.rs'].includes('ProxyConfig::load') || files['oxideproxy/src/config.rs'].includes('pub fn load('), 'OxideProxy exposes a fallible configuration loader');
assert(!files['oxideproxy/src/config.rs'].includes('pub fn load_or_default'), 'OxideProxy cannot silently fall back after a configuration error');
for (const composeFile of ['docker-compose.yml', 'docker-compose.staging.yml']) {
  assert(files[composeFile].includes('ACCESS_GATE_ENABLED=${ACCESS_GATE_ENABLED:-true}'), `${composeFile} keeps the development access gate enabled by default`);
  assert(files[composeFile].includes('ACCESS_GATE_DOMAIN=${ACCESS_GATE_DOMAIN:-ragenodes.dev}'), `${composeFile} protects the canonical development domain`);
  assert(files[composeFile].includes('ACCESS_GATE_ALLOWED_EMAIL_DOMAIN=${ACCESS_GATE_ALLOWED_EMAIL_DOMAIN:-ragenodes.com}'), `${composeFile} restricts OTP delivery to the corporate email domain`);
}
assert(files['oxideproxy/src/access_gate.rs'].includes('DEFAULT_ALLOWED_EMAIL_DOMAIN: &str = "ragenodes.com"'), 'access gate fails closed to the corporate email domain');
assert(files['oxideproxy/src/access_gate.rs'].includes('if attempts >= 3'), 'access gate blacklists an IP after three invalid email attempts');
assert(files['oxideproxy/src/access_gate.rs'].includes('const SESSION_TTL_SECS: u64 = 24 * 60 * 60'), 'access gate grants only a 24-hour verified session');
assert(files['oxideproxy/src/access_gate.rs'].includes('Secure; HttpOnly; SameSite=Lax'), 'access gate preserves its session across top-level OAuth callbacks');
assert(!files['oxideproxy/src/access_gate.rs'].includes('Secure; HttpOnly; SameSite=Strict'), 'access gate cannot hide its session from OAuth callbacks');
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
assert(files['oxideproxy/node_panel/server.js'].includes('reconcileAutomaticRoutes'), 'Oxide route sync tolerates partial inventory snapshots');
assert(files['oxideproxy/node_panel/routeReconciliation.js'].includes('count < requiredConfirmations'), 'Oxide retains a missing route until consecutive failures confirm its removal');
assert(files['.env.example'].includes('DOCKER_SOCKET=/run/user/1000/docker.sock'), 'production example uses a rootless Docker socket');
assert(files['.env.example'].includes('STAGING_GAME_DATA_GID='), 'staging documents the remapped rootless game-data group');
assert(files['docker-compose.staging.yml'].includes('STAGING_GAME_DATA_GID:-${GAME_DATA_GID:-1000}'), 'staging control services use their dedicated remapped game-data group');
assert(files['deploy_staging.sh'].includes('worker-stats-staging'), 'staging deploys its metrics worker on every release');
assert(files['deploy_staging.sh'].includes('worker-backups-staging'), 'staging deploys its backup scheduler on every release');
assert(files['docker-compose.staging.yml'].includes('RAGENODES_ROLE=worker-backups'), 'staging defines the isolated backup scheduler');
assert(files['docker-compose.registry.staging.yml'].includes('worker-backups-staging:'), 'staging backup scheduler uses the reviewed backend image');
assert(files['backend/src/services/backupService.js'].includes('normalizeSharedDataPermissions(container, config.gameContainerSharedGid)'), 'backups repair private game-runtime directories through the bounded shared group');
assert(files['backend/src/services/backupService.js'].includes('{ maintenanceResume: true }'), 'backup restore resumes its already-admitted server after maintenance');
assert(files['backend/src/services/serverControlService.js'].includes('if (!options.maintenanceResume)'), 'normal server starts retain node capacity admission');
for (const deployFile of ['deploy.sh', 'deploy_staging.sh']) {
  assert(files[deployFile].includes('prepare_runtime_images.sh'), `${deployFile} prefers reviewed Registry images`);
  assert(files[deployFile].includes('RAGENODES_REGISTRY_REQUIRED'), `${deployFile} supports fail-closed Registry deployment`);
  assert(files[deployFile].includes('REGISTRY_DEPLOY=false'), `${deployFile} retains an explicit source-build recovery path`);
}
for (const ref of files['deploy/registry-release.lock'].match(/registry\.gitlab\.com[^\r\n]+/g) || []) {
  assert(/@sha256:[0-9a-f]{64}$/.test(ref), 'reviewed Registry release uses an immutable digest');
}
assert(files['scripts/registry/prepare_runtime_images.sh'].includes('docker pull "$ref"'), 'Registry release images are downloaded before application recreation');
assert(files['scripts/registry/prepare_runtime_images.sh'].includes('grep -Fx "$ref"'), 'downloaded Registry images are verified against the reviewed digest');
assert(files['scripts/registry/build_and_push_kaniko.sh'].includes('if ! run_kaniko true'), 'Registry builds detect a failed cached Kaniko attempt');
assert(files['scripts/registry/build_and_push_kaniko.sh'].includes('run_kaniko false'), 'Registry builds retry once without a potentially corrupt cache');
assert(files['scripts/registry/build_and_push_kaniko.sh'].includes('rm -f "$digest_file"'), 'Kaniko recovery discards a stale digest before retrying');
assert(files['scripts/registry/build_and_push_kaniko.sh'].includes('rm -rf /kaniko/0 /kaniko/stages'), 'Kaniko recovery clears partial build stages before retrying');
assert(files['auto_update_staging.sh'].includes('git -c gc.auto=0 fetch'), 'staging updater cannot leak its deployment lock into background Git maintenance');
assert(files['auto_update_staging.sh'].includes('RUNTIME_CONFIG="oxideproxy/game_config/oxide_proxy.yml"'), 'staging updater identifies the OxideProxy runtime config explicitly');
assert(files['auto_update_staging.sh'].includes('\":(exclude)$RUNTIME_CONFIG\"'), 'staging updater permits only the generated OxideProxy config outside the clean-worktree guard');
assert(files['auto_update_staging.sh'].includes('restore_runtime_config'), 'staging updater restores live OxideProxy routes across deploy and rollback');
assert(files['auto_update_staging.sh'].includes('ragenodes_pending_staging_deploy'), 'staging updater persists an interrupted-deployment marker');
assert(files['auto_update_staging.sh'].includes('Despliegue interrumpido detectado'), 'staging updater resumes an interrupted deployment');
assert(files['auto_update_staging.sh'].includes('timeout --foreground --signal=TERM --kill-after=60'), 'staging updater bounds deployment execution time');
assert(files['auto_update_staging.sh'].indexOf('[ "$LOCAL" = "$REMOTE" ] && [ ! -f "$PENDING_DEPLOY_FILE" ]') < files['auto_update_staging.sh'].indexOf('\npreserve_runtime_config_if_modified\n'), 'staging idle polls do not rewrite the live OxideProxy config');
assert(files['auto_update_staging.sh'].indexOf('write_pending_deploy "$LOCAL" "$REMOTE"') < files['auto_update_staging.sh'].indexOf('git merge --ff-only "$REMOTE"'), 'staging records pending state before advancing Git');
assert(files['auto_update_prod.sh'].includes('RUNTIME_CONFIG="oxideproxy/game_config/oxide_proxy.yml"'), 'production updater identifies the OxideProxy runtime config explicitly');
assert(files['auto_update_prod.sh'].includes('\":(exclude)$RUNTIME_CONFIG\"'), 'production updater permits only the generated OxideProxy config outside the clean-worktree guard');
assert(files['auto_update_prod.sh'].includes('restore_runtime_config'), 'production updater restores live OxideProxy routes across deploy and rollback');
assert(files['auto_update_prod.sh'].includes('ragenodes_pending_prod_deploy'), 'production updater persists an interrupted-deployment marker');
assert(files['auto_update_prod.sh'].includes('Despliegue interrumpido detectado'), 'production updater resumes an interrupted deployment');
assert(files['auto_update_prod.sh'].includes('timeout --foreground --signal=TERM --kill-after=60'), 'production updater bounds deployment execution time');
assert(files['auto_update_prod.sh'].indexOf('[ "$LOCAL" = "$REMOTE" ] && [ ! -f "$PENDING_DEPLOY_FILE" ]') < files['auto_update_prod.sh'].indexOf('\npreserve_runtime_config_if_modified\n'), 'production idle polls do not rewrite the live OxideProxy config');
assert(files['auto_update_prod.sh'].indexOf('write_pending_deploy "$LOCAL" "$REMOTE"') < files['auto_update_prod.sh'].indexOf('git merge --ff-only "$REMOTE"'), 'production records pending state before advancing Git');
assert(files['.env.example'].includes('ALLOW_ROOTFUL_DOCKER_SOCKET=false'), 'rootful Docker exception is disabled by default');
assert(files['.env.example'].includes('FRONTEND_BIND_IP=127.0.0.1'), 'auxiliary frontend bind is explicitly loopback-only');
assert(files['.env.example'].includes('DISCORD_API_KEY=') && files['.env.example'].includes('NODE_ENROLLMENT_API_KEY='), 'Discord and node enrollment use separate credentials');
assert(!files['docker-compose.yml'].includes('DISCORD_API_KEY:-${API_KEY') && !files['docker-compose.staging.yml'].includes('DISCORD_API_KEY:-${API_KEY'), 'Compose requires the dedicated Discord credential without eager legacy interpolation');
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
assert(files['docker-compose.staging.yml'].match(/PORT_BASE_OFFSET(?::|=)\s*\$\{STAGING_PORT_BASE_OFFSET:-1000\}/g)?.length === 3, 'staging backend and operational workers share a configurable non-overlapping port offset');
assert(files['docker-compose.yml'].includes('PORT_SCAN_LIMIT: ${PRODUCTION_PORT_SCAN_LIMIT:-999}'), 'production allocation stays inside its 1000-port band');
assert(files['docker-compose.staging.yml'].includes('PORT_SCAN_LIMIT: ${STAGING_PORT_SCAN_LIMIT:-999}'), 'staging allocation stays inside its shifted 1000-port band');
const stagingControlPanelOverride = files['docker-compose.staging.yml'].match(/\r?\n  oxide_control_panel:\r?\n([\s\S]*?)(?=\r?\n  oxide_game_runtime_init_staging:)/)?.[1] || '';
assert(!stagingControlPanelOverride.includes('security_opt:'), 'staging does not duplicate inherited control-panel security options');
assert(!stagingControlPanelOverride.includes('cap_drop:'), 'staging does not duplicate inherited control-panel capability drops');
assert(files['docker-compose.yml'].includes('network_mode: host'), 'Oxide Game can bind active public game ports without broad Docker ranges');
const productionGameProxy = files['docker-compose.yml'].match(/\r?\n  oxide_game:\r?\n([\s\S]*?)(?=\r?\n  oxide_web:)/)?.[1] || '';
assert(productionGameProxy.includes('user: "0:0"'), 'Oxide Game uses the loader identity required by the kernel');
assert(productionGameProxy.includes('cap_drop: [ALL]'), 'Oxide Game drops every ambient capability');
assert(productionGameProxy.includes('cap_add: [NET_ADMIN, BPF, PERFMON]') && !productionGameProxy.includes('SYS_ADMIN'), 'Oxide Game receives only the bounded XDP capabilities');
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
assert(files['backend/src/services/games/minecraft.js'].includes("'PAUSE_WHEN_EMPTY_SECONDS=-1'"), 'Minecraft stays active while empty');
assert(files['backend/src/services/serverControlService.js'].includes("process.env.RAGENODES_ROLE === 'worker-docker-events'"), 'game maintenance has a single worker owner');
assert(files['backend/src/services/serverControlService.js'].includes("hasFatalLog && containerHealth === 'unhealthy'"), 'stale fatal log text cannot recreate a healthy game server');
assert(!files['backend/src/services/serverControlService.js'].includes("sameSite:\\\"lax\\\"/sameSite:\\\"none\\\",secure:true,partitioned:true"), 'FiveM startup cannot force txAdmin OAuth cookies into a partitioned store');
assert(files['backend/src/services/serverControlService.js'].includes("SameSite=None;Secure;Partitioned/SameSite=Lax"), 'FiveM startup repairs legacy partitioned txAdmin bundles');
assert(files['backend/src/services/games/rust.js'].includes("deriveServiceIdentifier('rust'"), 'Rust identity is unique per server');
assert(files['backend/src/services/games/cs2.js'].includes("'SRCDS_TICKRATE=64'"), 'CS2 uses the standard beginner-friendly tickrate');
assert(files['backend/src/services/games/valheim.js'].includes("deriveServiceIdentifier('world'"), 'Valheim world names are unique per server');
for (const deployFile of ['deploy.sh', 'deploy_staging.sh']) {
  const deploy = files[deployFile];
  const redisService = deployFile === 'deploy.sh' ? 'redis' : 'redis-staging';
  const runtimeInitService = deployFile === 'deploy.sh' ? 'oxide_game_runtime_init' : 'oxide_game_runtime_init_staging';
  assert(deploy.includes('bash ./scripts/ensure_base_images.sh'), `${deployFile} prepares game images before application services`);
  assert(deploy.indexOf('bash ./scripts/ensure_base_images.sh') < deploy.indexOf('build "${APP_SERVICES[@]}"'), `${deployFile} cannot publish a backend before its game images exist`);
  assert(deploy.includes(`STATE_SERVICES=(\n  ${redisService}\n)`), `${deployFile} declares Redis as required deployment state`);
  assert(deploy.indexOf('up -d "${STATE_SERVICES[@]}"') < deploy.indexOf('up -d --no-deps "${APP_SERVICES[@]}"'), `${deployFile} applies Redis configuration before application services`);
  assert(deploy.includes(`run --rm --no-deps ${runtimeInitService}`), `${deployFile} prepares the persistent OxideProxy runtime volume`);
  assert(deploy.indexOf(`run --rm --no-deps ${runtimeInitService}`) < deploy.indexOf('up -d --no-deps "${APP_SERVICES[@]}"'), `${deployFile} prepares OxideProxy storage before application startup`);
  assert(deploy.includes(`wait_for_service ${redisService} 60`), `${deployFile} waits for Redis readiness before application startup`);
  assert(deploy.includes('wait_for_http()'), `${deployFile} waits for HTTP readiness instead of checking only once`);
  assert(/wait_for_http http:\/\/127\.0\.0\.1:\d+\/healthz 90/.test(deploy), `${deployFile} retries the health endpoint during startup`);
  assert(/wait_for_http http:\/\/127\.0\.0\.1:\d+\/readyz 90/.test(deploy), `${deployFile} retries the readiness endpoint during startup`);
}

assert(files['docker-compose.yml'].includes('oxide_game_runtime_init:'), 'production declares an isolated OxideProxy runtime initializer');
assert(files['docker-compose.staging.yml'].includes('oxide_game_runtime_init_staging:'), 'staging declares an isolated OxideProxy runtime initializer');
assert(files['docker-compose.staging.yml'].includes('phpmyadmin-staging:'), 'staging declares its isolated phpMyAdmin service');
assert(/phpmyadmin-staging:[\s\S]*?aliases:\s*\n\s*- phpmyadmin/.test(files['docker-compose.staging.yml']), 'staging exposes phpMyAdmin through the internal proxy alias');
assert(files['docker-compose.staging.yml'].includes('STAGING_PUBLIC_BASE_URL:-https://panel.ragenodes.dev'), 'staging phpMyAdmin keeps redirects on the staging panel origin');
assert(files['deploy_staging.sh'].includes('  phpmyadmin-staging'), 'staging deploys phpMyAdmin automatically');
for (const composeFile of ['docker-compose.yml', 'docker-compose.staging.yml']) {
  const compose = files[composeFile];
  assert(compose.includes('chown -R 0:${APP_GID:-1000} /runtime'), `${composeFile} grants the unprivileged control panel group access to runtime telemetry`);
  assert(compose.includes('chmod 2750 /runtime /runtime/logs'), `${composeFile} preserves the telemetry group on new metrics and trace files`);
}

if (failures) {
  console.error(`Deployment security contract failed: ${failures} finding(s).`);
  process.exit(1);
}

console.log('Deployment security contract passed.');

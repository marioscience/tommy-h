import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildRestartOptions } from '../src/services/serverRestartOptions.js';

describe('Backend architecture boundaries', () => {
  it('keeps lifecycle control dependent on server queries without a reverse dependency', async () => {
    const queries = await readFile(new URL('../src/services/serverService.js', import.meta.url), 'utf8');
    const control = await readFile(new URL('../src/services/serverControlService.js', import.meta.url), 'utf8');
    assert.match(control, /from '.\/serverService\.js'/);
    assert.doesNotMatch(queries, /server(?:ControlService|Settings|Subusers)/);
    assert.doesNotMatch(control, /export async function (?:deleteServer|repairServer|repairOneServer|runServerMaintenance)/);
  });

  it('keeps periodic maintenance owned by the worker scheduler', async () => {
    const control = await readFile(new URL('../src/services/serverMaintenanceService.js', import.meta.url), 'utf8');
    const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
    assert.doesNotMatch(control, /setInterval\s*\(/);
    assert.match(worker, /startServerMaintenance\(\)/);
  });

  it('starts Docker telemetry explicitly from the stats worker', async () => {
    const dockerService = await readFile(new URL('../src/services/dockerService.js', import.meta.url), 'utf8');
    const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
    assert.doesNotMatch(dockerService, /dockerTelemetryOwner/);
    assert.match(worker, /startDockerTelemetryCollector\(\)/);
    assert.match(worker, /startNodeMonitor\(\)/);
  });

  it('runs durable provisioning only from the deployments worker', async () => {
    const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
    const routes = await readFile(new URL('../src/routes/servers.js', import.meta.url), 'utf8');
    assert.match(worker, /case 'worker-deployments':[\s\S]*startDeploymentWorker\(\)/);
    assert.match(routes, /planAndEnqueueDeployment/);
    assert.match(routes, /statusUrl: `\/api\/servers\/deployment-jobs\/\$\{job\.id\}`/);
    assert.doesNotMatch(routes, /await createServerForUser\(/);
  });

  it('keeps scheduled jobs out of horizontally scaled API replicas', async () => {
    const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
    const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
    assert.match(worker, /case 'worker-backups':[\s\S]*startCronManager\(\)/);
    assert.doesNotMatch(server, /startCronManager/);
  });

  it('owns database maintenance and durable backup execution in the backup worker', async () => {
    const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
    const db = await readFile(new URL('../src/db.js', import.meta.url), 'utf8');
    const queue = await readFile(new URL('../src/services/backupQueue.js', import.meta.url), 'utf8');
    const repository = await readFile(new URL('../src/repositories/backupJobRepository.js', import.meta.url), 'utf8');
    assert.match(worker, /case 'worker-backups':[\s\S]*startDbMaintenance\(\)[\s\S]*startBackupWorker\(\)/);
    assert.doesNotMatch(db.match(/export async function initDb[\s\S]*?\n\}/)?.[0] || '', /startDbMaintenance/);
    assert.doesNotMatch(queue, /new Map|queueMicrotask|createFullBackup/);
    assert.match(repository, /FOR UPDATE SKIP LOCKED/);
    assert.match(repository, /status IN \('queued', 'running'\)/);
    assert.match(worker, /superviseLongRunningTask\('backup-queue', startBackupWorker\(\)\)/);
    assert.match(worker, /setImmediate\(\(\) => process\.exit\(1\)\)/);
  });

  it('bounds telemetry fan-out and protects periodic schedulers from overlap', async () => {
    const stats = await readFile(new URL('../src/services/statsCollector.js', import.meta.url), 'utf8');
    const backups = await readFile(new URL('../src/services/backupScheduler.js', import.meta.url), 'utf8');
    const billing = await readFile(new URL('../src/services/billingScheduler.js', import.meta.url), 'utf8');
    assert.match(stats, /STATS_COLLECTION_CONCURRENCY/);
    assert.match(stats, /servers\.slice\(offset, offset \+ statsConcurrency\)/);
    assert.match(backups, /scheduleRunning/);
    assert.match(billing, /if \(running\) return/);
  });

  it('batches historical writes and rewrites FiveM cache files only on change', async () => {
    const stats = await readFile(new URL('../src/services/statsCollector.js', import.meta.url), 'utf8');
    const warmer = await readFile(new URL('../src/services/queryCache.js', import.meta.url), 'utf8');
    assert.match(stats, /SELECT \* FROM UNNEST/);
    assert.doesNotMatch(stats, /DELETE FROM server_stats_history/);
    assert.match(warmer, /template = 'fivem'/);
    assert.match(warmer, /knownHashes\.get\(key\) === hash/);
  });

  it('builds one canonical restart contract for every game adapter', () => {
    const options = buildRestartOptions({
      id: 'server-id',
      container_name: 'ragenodes-server-id',
      data_path: '/srv/server-id',
      fivem_port: 30120,
      txadmin_port: 40120,
      name: 'Test',
      mc_version: '1.21.4',
      mc_type: 'PAPER',
      db_name: 'game',
      db_user: 'user',
      db_pass: 'secret',
      node_id: 2,
      cluster_id: 'cluster',
      cpuset: '0-1'
    }, { memoryBytes: 1024 }, 'license');

    assert.equal(options.gamePort, 30120);
    assert.equal(options.serverId, 'server-id');
    assert.equal(options.licenseKey, 'license');
    assert.deepEqual(options.plan, { memoryBytes: 1024 });
    assert.equal(options.cpuset, '0-1');
  });

  it('keeps extracted persistence out of HTTP and orchestration modules', async () => {
    const files = [
      '../src/routes/adminNodes.js',
      '../src/routes/adminUsers.js',
      '../src/routes/auth.js',
      '../src/routes/notifications.js',
      '../src/middleware/auth.js',
      '../src/services/backupService.js',
      '../src/services/serverControlService.js',
      '../src/services/serverDeletionService.js',
      '../src/services/serverMaintenanceService.js',
      '../src/services/serverRepairService.js',
      '../src/services/stagingHealthTestRunner.js'
    ];
    const source = (await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), 'utf8')))).join('\n');
    assert.doesNotMatch(source, /(?:FROM|INTO|UPDATE|DELETE FROM)\s+(?:backups|edge_proxies|notifications)\b/i);
    assert.doesNotMatch(source, /(?:FROM|INTO|UPDATE|DELETE FROM)\s+users\b/i);
  });

  it('purges server data before deleting its database record', async () => {
    const control = await readFile(new URL('../src/services/serverDeletionService.js', import.meta.url), 'utf8');
    const purgeIndex = control.indexOf('await purgeServerDataDirectory(server.node_id, server.id, server.data_path)');
    const recordIndex = control.indexOf('await deleteServerRecord(server.id)');
    assert.ok(purgeIndex >= 0, 'server deletion must purge persistent data');
    assert.ok(recordIndex > purgeIndex, 'the database record must remain available if data cleanup fails');
    assert.doesNotMatch(control, /fs\.rm\(s\.data_path[\s\S]*catch\s*\{\s*\}/);
  });

  it('uses rootless-safe cleanup when a server creation is rolled back', async () => {
    const runtime = await readFile(new URL('../src/services/serverProvisioningRuntime.js', import.meta.url), 'utf8');
    assert.match(runtime, /await purgeServerDataDirectory\(nodeId, serverId, dataPath\)/);
    assert.doesNotMatch(runtime, /runRemoteCommand\(nodeId,[\s\S]{0,80}rm -rf/);
  });

  it('keeps deployment persistence and game database administration out of orchestration', async () => {
    const creation = await readFile(new URL('../src/services/serverCreationService.js', import.meta.url), 'utf8');
    assert.doesNotMatch(creation, /\bquery\s*\(/);
    assert.doesNotMatch(creation, /mysql2|CREATE DATABASE|DROP DATABASE|CREATE USER|DROP USER/);
    assert.match(creation, /insertCreatingServer/);
    assert.match(creation, /createGameDatabase/);
    assert.doesNotMatch(creation, /GameFactory|createPalworldContainer|purgeServerDataDirectory/);
  });

  it('keeps server presentation free of SQL and duplicate database administration', async () => {
    const service = await readFile(new URL('../src/services/serverService.js', import.meta.url), 'utf8');
    assert.doesNotMatch(service, /\bquery(?:Cached)?\s*\(/);
    assert.doesNotMatch(service, /mysql2|CREATE DATABASE|CREATE USER|GRANT ALL PRIVILEGES/);
    assert.match(service, /findServerAccessibleToUser/);
    assert.match(service, /createGameDatabase/);
  });

  it('keeps backup archive mechanics separate from backup workflows', async () => {
    const workflow = await readFile(new URL('../src/services/backupService.js', import.meta.url), 'utf8');
    const archive = await readFile(new URL('../src/services/backupArchiveService.js', import.meta.url), 'utf8');
    assert.doesNotMatch(workflow, /spawn\(|createReadStream/);
    assert.match(workflow, /createBackupArchive/);
    assert.match(archive, /partialPath/);
    assert.match(archive, /sha256File/);
    assert.match(archive, /startsWith\(`\$\{backupRoot\}\$\{path\.sep\}`\)/);
  });

  it('keeps transactional backup restore isolated with explicit rollback', async () => {
    const workflow = await readFile(new URL('../src/services/backupService.js', import.meta.url), 'utf8');
    const restore = await readFile(new URL('../src/services/backupRestoreService.js', import.meta.url), 'utf8');
    assert.doesNotMatch(workflow, /export async function restoreBackup/);
    assert.match(restore, /rollbackFiles/);
    assert.match(restore, /replaceDatabaseFromDump/);
    assert.match(restore, /maintenanceResume: true/);
  });

  it('keeps remote sync and server migration outside core backup workflows', async () => {
    const workflow = await readFile(new URL('../src/services/backupService.js', import.meta.url), 'utf8');
    const remote = await readFile(new URL('../src/services/backupRemoteService.js', import.meta.url), 'utf8');
    const migration = await readFile(new URL('../src/services/serverResourceMigrationService.js', import.meta.url), 'utf8');
    assert.doesNotMatch(workflow, /rclone|rsync|migrateResources|syncBackupsToRemote/);
    assert.match(remote, /rclone/);
    assert.match(migration, /rsync/);
    assert.match(migration, /assertSafeBackupDataPath/);
  });

  it('keeps txAdmin presentation patches out of generic Docker utilities', async () => {
    const utilities = await readFile(new URL('../src/services/dockerUtils.js', import.meta.url), 'utf8');
    const branding = await readFile(new URL('../src/services/txAdminBrandingService.js', import.meta.url), 'utf8');
    assert.doesNotMatch(utilities, /RAGENODES_WHITE_LABEL_PATCH/);
    assert.match(branding, /RAGENODES_WHITE_LABEL_PATCH_START/);
    assert.match(branding, /txadmin-white-label|txAdmin|TXADMIN_INDEX_PATH/i);
  });

  it('keeps game identity and sandbox policy independent from Docker transport', async () => {
    const utilities = await readFile(new URL('../src/services/dockerUtils.js', import.meta.url), 'utf8');
    const policy = await readFile(new URL('../src/services/gameRuntimePolicy.js', import.meta.url), 'utf8');
    assert.doesNotMatch(utilities, /deriveServicePassword|GAME_SECURITY_CONFIG/);
    assert.match(policy, /createHmac/);
    assert.match(policy, /no-new-privileges:true/);
    assert.match(policy, /CapDrop: \['ALL'\]/);
  });

  it('keeps node transport and mTLS outside generic Docker utilities', async () => {
    const utilities = await readFile(new URL('../src/services/dockerUtils.js', import.meta.url), 'utf8');
    const transport = await readFile(new URL('../src/services/dockerNodeService.js', import.meta.url), 'utf8');
    assert.doesNotMatch(utilities, /dockerode|PassThrough|findNodeById|allowInsecureDockerNodes/);
    assert.match(transport, /dockerode/);
    assert.match(transport, /protocol: 'https'/);
    assert.match(transport, /faltan certificados mTLS/);
  });

  it('keeps txAdmin fleet patching with the branding owner', async () => {
    const dockerService = await readFile(new URL('../src/services/dockerService.js', import.meta.url), 'utf8');
    const branding = await readFile(new URL('../src/services/txAdminBrandingService.js', import.meta.url), 'utf8');
    const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
    assert.doesNotMatch(dockerService, /patchExistingContainers/);
    assert.match(branding, /export async function patchExistingContainers/);
    assert.match(worker, /txAdminBrandingService/);
  });

  it('keeps Blender runtime outside generic Docker lifecycle operations', async () => {
    const dockerService = await readFile(new URL('../src/services/dockerService.js', import.meta.url), 'utf8');
    const blender = await readFile(new URL('../src/services/blenderRuntimeService.js', import.meta.url), 'utf8');
    assert.doesNotMatch(dockerService, /toggleBlender|blenderBaseImage/);
    assert.match(blender, /export async function toggleBlender/);
    assert.match(blender, /no-new-privileges:true/);
    assert.match(blender, /Memory: 4 \* 1024 \* 1024 \* 1024/);
  });

  it('keeps Discord knowledge persistence outside infrastructure routes', async () => {
    const routes = await readFile(new URL('../src/routes/discord.js', import.meta.url), 'utf8');
    const knowledge = await readFile(new URL('../src/routes/discord/knowledgeRoutes.js', import.meta.url), 'utf8');
    assert.match(routes, /registerKnowledgeRoutes\(router, verifyApiKey\)/);
    assert.doesNotMatch(routes, /bot_knowledge|bot_ticket_logs|bot_stats/);
    assert.match(knowledge, /router\.post\('\/aprender'/);
    assert.match(knowledge, /router\.post\('\/ticket-log'/);
    assert.match(knowledge, /router\.get\('\/estadisticas'/);
  });

  it('keeps the admin commercial catalog separate from server operations', async () => {
    const admin = await readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
    const catalog = await readFile(new URL('../src/routes/admin/catalogRoutes.js', import.meta.url), 'utf8');
    assert.match(admin, /registerCatalogRoutes\(router\)/);
    assert.doesNotMatch(admin, /hosting_plans|disk_plans|marketplace_scripts|createBillingPlan/);
    assert.match(catalog, /router\.get\('\/hosting-plans'/);
    assert.match(catalog, /router\.get\('\/disk-plans'/);
    assert.match(catalog, /router\.put\('\/marketplace\/scripts\/:id'/);
    assert.match(catalog, /router\.post\('\/paypal\/sync-plans'/);
  });

  it('keeps admin notifications and auditing in their observability boundary', async () => {
    const admin = await readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
    const observability = await readFile(new URL('../src/routes/admin/observabilityRoutes.js', import.meta.url), 'utf8');
    assert.match(admin, /registerObservabilityRoutes\(router\)/);
    assert.doesNotMatch(admin, /createNotification|listAdminNotifications/);
    assert.doesNotMatch(admin, /router\.(?:get|delete)\('\/audit-logs/);
    assert.match(observability, /router\.get\('\/notifications'/);
    assert.match(observability, /router\.get\('\/audit-logs\/export'/);
    assert.match(observability, /admin\.audit\.clear_all/);
  });

  it('keeps privileged admin server operations in route-specificity order', async () => {
    const admin = await readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
    const servers = await readFile(new URL('../src/routes/admin/serverRoutes.js', import.meta.url), 'utf8');
    assert.match(admin, /registerServerRoutes\(router\)/);
    assert.doesNotMatch(admin, /controlServer|restoreBackup|executeCommandInContainer/);
    const restoreIndex = servers.indexOf("router.post('/servers/:id/backups/restore'");
    const actionIndex = servers.indexOf("router.post('/servers/:id/:action'");
    assert.ok(restoreIndex >= 0 && actionIndex > restoreIndex);
    assert.match(servers, /backupQueue\.enqueue/);
    assert.match(servers, /admin\.server\.exec/);
  });

  it('keeps read-only payment routes outside checkout mutation workflows', async () => {
    const payments = await readFile(new URL('../src/routes/payments.js', import.meta.url), 'utf8');
    const reads = await readFile(new URL('../src/routes/payments/readRoutes.js', import.meta.url), 'utf8');
    assert.match(payments, /registerPaymentReadRoutes\(router, requireAuth\)/);
    assert.doesNotMatch(payments, /listInvoicesForUser|renderInvoiceHtml|paypalClient/);
    assert.match(reads, /router\.get\('\/client-config'/);
    assert.match(reads, /router\.get\('\/plans'/);
    assert.match(reads, /router\.get\('\/invoices\/:id\.html'/);
  });

  it('keeps authenticated subscription management outside initial checkout', async () => {
    const payments = await readFile(new URL('../src/routes/payments.js', import.meta.url), 'utf8');
    const subscriptions = await readFile(new URL('../src/routes/payments/subscriptionRoutes.js', import.meta.url), 'utf8');
    const validation = await readFile(new URL('../src/routes/payments/paymentValidation.js', import.meta.url), 'utf8');
    assert.match(payments, /registerSubscriptionRoutes\(router, requireAuth\)/);
    assert.doesNotMatch(payments, /payment\.disk_subscription|payment\.plan_revised/);
    assert.match(subscriptions, /router\.post\('\/register-disk-subscription'/);
    assert.match(subscriptions, /router\.post\('\/revise-plan'/);
    assert.match(subscriptions, /router\.post\('\/confirm-revise'/);
    assert.match(validation, /export function isPayPalSubscriptionId/);
  });

  it('keeps checkout consent capture separate from account provisioning', async () => {
    const payments = await readFile(new URL('../src/routes/payments.js', import.meta.url), 'utf8');
    const agreements = await readFile(new URL('../src/routes/payments/agreementRoutes.js', import.meta.url), 'utf8');
    const context = await readFile(new URL('../src/routes/payments/checkoutContext.js', import.meta.url), 'utf8');
    assert.match(payments, /registerAgreementRoutes\(router, checkoutLimiter\)/);
    assert.doesNotMatch(payments, /legal\.checkout_agreement\.accepted|legal_documents/);
    assert.match(agreements, /router\.post\('\/check-availability'/);
    assert.match(agreements, /router\.post\('\/checkout-agreement'/);
    assert.match(context, /export function cleanAgreementValue/);
  });

  it('keeps CS2 port retries idempotent after rootless ownership normalization', async () => {
    const cs2 = await readFile(new URL('../src/services/games/cs2.js', import.meta.url), 'utf8');
    assert.match(cs2, /runRemoteCommand\(opts\.nodeId \|\| 0, sh`mkdir -p \$\{opts\.dataPath\}`\)/);
    assert.doesNotMatch(cs2, /mkdir -p \$\{opts\.dataPath\} && chown -R/);
    assert.match(cs2, /await normalizeCS2DataOwnership/);
  });

  it('keeps the final 7DTD path absent until the atomic template clone is promoted', async () => {
    const sdtd = await readFile(new URL('../src/services/games/sdtd.js', import.meta.url), 'utf8');
    const cloneIndex = sdtd.indexOf("cloneFromMasterTemplate('sdtd', dataPath, nodeId)");
    assert.ok(cloneIndex >= 0, '7DTD must prepare its shared template before configuring the instance');
    assert.doesNotMatch(sdtd.slice(0, cloneIndex), /mkdir -p \$\{dataPath\}/);
  });

  it('runs the runtime anomaly monitor only from the docker-events worker', async () => {
    const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
    const scheduler = await readFile(new URL('../src/services/runtimeAnomalyScheduler.js', import.meta.url), 'utf8');
    assert.match(worker, /case 'worker-docker-events':[\s\S]*startRuntimeAnomalyMonitor\(\)/);
    assert.match(scheduler, /scanRuntimeAnomalies\(\)/);
  });

  it('does not recreate a server while its initial installation is active', async () => {
    const control = await readFile(new URL('../src/services/serverControlService.js', import.meta.url), 'utf8');
    assert.match(control, /\['creating', 'recreating'\]\.includes\(server\.status\)/);
    assert.match(control, /todavía se está preparando/);
  });

  it('targets power operations at the node assigned to the server row', async () => {
    const control = await readFile(new URL('../src/services/serverControlService.js', import.meta.url), 'utf8');
    const lifecycle = await readFile(new URL('../src/services/serverRuntimeLifecycle.js', import.meta.url), 'utf8');
    assert.match(control, /startContainer\(server\.container_name, \{ nodeId: server\.node_id \}\)/);
    assert.match(control, /stopContainer\(server\.container_name, \{ nodeId: server\.node_id \}\)/);
    assert.match(lifecycle, /inspectContainer\(server\.container_name, \{ nodeId: server\.node_id \}\)/);
  });

  it('shares the configured MariaDB endpoint with FiveM and authorized clients', async () => {
    const fivem = await readFile(new URL('../src/services/games/fivem.js', import.meta.url), 'utf8');
    const servers = await readFile(new URL('../src/services/serverService.js', import.meta.url), 'utf8');
    assert.match(fivem, /TXHOST_DEFAULT_DBHOST=\$\{config\.gameDatabaseHost\}/);
    assert.match(fivem, /TXHOST_DEFAULT_DBPORT=\$\{config\.gameDatabasePort\}/);
    assert.match(servers, /s\.db_host = config\.gameDatabaseHost/);
    assert.match(servers, /if \(canViewSecrets && s\.template === 'fivem'\)/);
  });

  it('prepares ARK without mutating rootless instance-directory permissions', async () => {
    const ark = await readFile(new URL('../src/services/games/ark.js', import.meta.url), 'utf8');
    const arkData = await readFile(new URL('../src/services/games/arkData.js', import.meta.url), 'utf8');
    assert.match(ark, /mkdir -p \$\{opts\.dataPath\}/);
    assert.match(ark, /cloneFromMasterTemplate\('ark', opts\.dataPath, targetNodeId, \{/);
    assert.match(ark, /refreshExisting: true/);
    assert.match(ark, /ShooterGame\/Saved/);
    assert.doesNotMatch(ark, /chmod 0?777/);
    assert.doesNotMatch(ark, /chmod 0?755/);
    assert.match(arkData, /chown -h 1000:1000 "\$target"/);
    assert.match(arkData, /find "\$target" -mindepth 1 -exec chown -h 1000:1000/);
  });

  it('starts ARK from the validated master without per-instance Steam updates', async () => {
    const ark = await readFile(new URL('../src/services/games/ark.js', import.meta.url), 'utf8');
    const arkData = await readFile(new URL('../src/services/games/arkData.js', import.meta.url), 'utf8');
    assert.match(ark, /'updateonstart=false'/);
    assert.doesNotMatch(ark, /'updateonstart=true'/);
    assert.match(ark, /echo 2399830 \| tee/);
    assert.match(arkData, /printf '2399830\\\\n'/);
    assert.doesNotMatch(ark, /echo 2430930 \| tee/);
    assert.doesNotMatch(arkData, /printf '2430930\\\\n'/);
    assert.match(ark, /touch \/home\/steam\/CONTAINER_ALREADY_STARTED_PLACEHOLDER/);
    assert.match(ark, /-Port=\$\{opts\.gamePort\}/);
    assert.doesNotMatch(ark, /\?Port=\$\{opts\.gamePort\}/);
  });

  it('publishes ARK through the isolated runtime network and game proxy inventory', async () => {
    const ark = await readFile(new URL('../src/services/games/ark.js', import.meta.url), 'utf8');
    assert.doesNotMatch(ark, /NetworkMode:\s*['"]host['"]/);
    assert.match(ark, /prepareGameProxyBindings\(publicBindings/);
    assert.match(ark, /NetworkingConfig:\s*\{ EndpointsConfig:\s*\{ \[config\.dockerNetwork\]/);
    assert.match(ark, /'ragenodes\.game': 'ark'/);
    assert.match(ark, /-ServerPlatform=ALL/);
    assert.doesNotMatch(ark, /chmod 0777/);
  });
});

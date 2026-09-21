import 'dotenv/config';
import { startDbMaintenance, waitForDb } from './db.js';
import { assertSecureConfig } from './config.js';
import { startDockerTelemetryCollector, startNodeMonitor } from './services/dockerService.js';
import { patchExistingContainers } from './services/txAdminBrandingService.js';
import { startAutoBackups } from './services/backupScheduler.js';
import { startStatsCollector } from './services/statsCollector.js';
import { startQueryWarmer } from './services/queryCache.js';
import { startBillingScheduler } from './services/billingScheduler.js';
import { startDockerEventsListener } from './services/dockerEventsService.js';
import { startServerMaintenance } from './services/serverMaintenanceScheduler.js';
import { startRuntimeAnomalyMonitor } from './services/runtimeAnomalyScheduler.js';
import { startDeploymentWorker } from './services/deploymentWorker.js';
import { startCronManager } from './services/cronManager.js';
import { startBackupWorker } from './services/backupWorker.js';
import { startDiskUsageCollector } from './services/diskUsageService.js';

import { logger, enableConsoleBridge } from "./utils/logger.js";
enableConsoleBridge();


const role = process.env.RAGENODES_ROLE || process.argv[2] || 'worker-backups';
const workerLog = logger.child({ module: 'worker', role });

process.on('uncaughtException', (err) => {
  workerLog.fatal({ err },'💥 WORKER CRASH (Uncaught Exception):');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  workerLog.error({ err: reason }, '💥 WORKER PROMESA RECHAZADA:');
});

assertSecureConfig();

function superviseLongRunningTask(name, promise) {
  void promise.catch((error) => {
    console.error(`[Worker] Tarea crítica ${name} finalizada inesperadamente:`, error);
    process.exitCode = 1;
    setImmediate(() => process.exit(1));
  });
}

async function boot() {
  await waitForDb();
  console.log(`[Worker] RageNodes iniciando rol: ${role}`);

  switch (role) {
    case 'worker-backups':
      startAutoBackups();
      startBillingScheduler();
      startCronManager();
      startDbMaintenance();
      superviseLongRunningTask('backup-queue', startBackupWorker());
      break;
    case 'worker-docker-events':
      await patchExistingContainers();
      startDockerEventsListener();
      await startQueryWarmer();
      startServerMaintenance();
      startRuntimeAnomalyMonitor();
      break;
    case 'worker-stats':
      startStatsCollector();
      startDockerTelemetryCollector();
      startDiskUsageCollector();

      startNodeMonitor();
      break;
    case 'worker-deployments':
      await startDeploymentWorker();
      break;
    default:
      workerLog.error(`Rol de worker desconocido: ${role}`);
      throw new Error(`Rol de worker desconocido: ${role}`);
  }

  workerLog.info(`[Worker] Rol ${role} activo.`);
}

boot().catch((error) => {
  workerLog.error(`[Worker] Error arrancando ${role}:`, error);
  process.exit(1);
});

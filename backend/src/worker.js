import 'dotenv/config';
import { waitForDb } from './db.js';
import { assertSecureConfig } from './config.js';
import { patchExistingContainers } from './services/dockerService.js';
import { startAutoBackups } from './services/backupScheduler.js';
import { startStatsCollector } from './services/statsCollector.js';
import { startQueryWarmer } from './services/queryCache.js';
import { startBillingScheduler } from './services/billingScheduler.js';
import { startDockerEventsListener } from './services/dockerEventsService.js';

process.on('uncaughtException', (err) => {
  console.error('💥 WORKER CRASH (Uncaught Exception):', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 WORKER PROMESA RECHAZADA:', reason);
});

const role = process.env.RAGENODES_ROLE || process.argv[2] || 'worker-backups';
assertSecureConfig();

async function boot() {
  await waitForDb();
  console.log(`[Worker] RageNodes iniciando rol: ${role}`);

  switch (role) {
    case 'worker-backups':
      startAutoBackups();
      startBillingScheduler();
      break;
    case 'worker-docker-events':
      patchExistingContainers();
      startDockerEventsListener();
      startQueryWarmer();
      break;
    case 'worker-stats':
      startStatsCollector();
      break;
    default:
      throw new Error(`Rol de worker desconocido: ${role}`);
  }

  console.log(`[Worker] Rol ${role} activo.`);
}

boot().catch((error) => {
  console.error(`[Worker] Error arrancando ${role}:`, error);
  process.exit(1);
});

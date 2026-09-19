import { runServerMaintenance } from './serverMaintenanceService.js';

const intervalMs = Math.max(300000, Number(process.env.MAINTENANCE_INTERVAL_MS || 600000));
let timer;

/** Starts the periodic scan exactly once in the docker-events worker. */
export function startServerMaintenance() {
  if (timer) return timer;
  timer = setInterval(() => {
    runServerMaintenance().catch((error) => {
      console.error('[Mantenimiento] Fallo no controlado:', error);
    });
  }, intervalMs);
  return timer;
}

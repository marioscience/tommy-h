import { config } from '../config.js';
import { scanRuntimeAnomalies } from './runtimeAnomalyMonitor.js';

let timer;

function runScan() {
  scanRuntimeAnomalies().catch((error) => {
    console.error('[RuntimeSecurity] Fallo no controlado:', error);
  });
}

export function startRuntimeAnomalyMonitor() {
  if (timer) return timer;
  const intervalMs = Math.max(60000, Number(config.runtimeAnomalyIntervalMs) || 300000);
  runScan();
  timer = setInterval(runScan, intervalMs);
  return timer;
}


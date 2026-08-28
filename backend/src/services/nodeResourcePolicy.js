import fs from 'fs/promises';
import os from 'os';

const GIB = 1024 ** 3;

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function getNodeRamPolicy(env = process.env) {
  return {
    overcommitRatio: boundedNumber(env.NODE_RAM_OVERCOMMIT_RATIO, 1.5, 1, 2),
    hostReserveGb: boundedNumber(env.NODE_HOST_RAM_RESERVE_GB, 8, 4, 32)
  };
}

export function calculateReservableRamGb(totalRamGb, policy = getNodeRamPolicy()) {
  const total = Math.max(0, Number(totalRamGb) || 0);
  const physicalForServices = Math.max(0, total - policy.hostReserveGb);
  return physicalForServices * policy.overcommitRatio;
}

export function assertStartMemoryAvailable(availableRamGb, requiredRamGb, policy = getNodeRamPolicy()) {
  const available = Number(availableRamGb);
  const required = Math.max(0, Number(requiredRamGb) || 0);
  if (!Number.isFinite(available)) return;

  if (available - required < policy.hostReserveGb) {
    throw new Error(
      `Memoria fisica insuficiente para iniciar el servicio: ` +
      `${available.toFixed(1)} GB disponibles, ${required.toFixed(1)} GB solicitados ` +
      `y ${policy.hostReserveGb} GB reservados para el host.`
    );
  }
}

export async function getLocalAvailableRamGb() {
  try {
    const meminfo = await fs.readFile('/proc/meminfo', 'utf8');
    const match = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
    if (match) return Number(match[1]) * 1024 / GIB;
  } catch {}
  return os.freemem() / GIB;
}

export async function assertNodeStartCapacity(nodeId, requiredRamGb, policy = getNodeRamPolicy()) {
  // Los nodos remotos necesitan publicar MemAvailable mediante su agente. No
  // se inventa telemetria: su capacidad reservable sigue protegiendose en el
  // selector y esta comprobacion fisica se aplica al maestro local.
  if (Number(nodeId) !== 0) return;
  assertStartMemoryAvailable(await getLocalAvailableRamGb(), requiredRamGb, policy);
}

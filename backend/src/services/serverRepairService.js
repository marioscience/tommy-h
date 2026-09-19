import fs from 'fs/promises';
import path from 'path';
import { logAudit } from '../db.js';
import { PLAN_LIMITS } from '../config.js';
import { getServerByIdForUser } from './serverService.js';
import { restartServerContainer } from './serverRuntimeLifecycle.js';
import { claimServerRecreation, updateServerStatus } from '../repositories/serverRepository.js';

export async function repairServer(id, userId, isAdmin) {
  const server = await getServerByIdForUser(id, userId, isAdmin);
  if (!server) throw new Error('No encontrado');
  if (!isAdmin && server.status === 'suspended') {
    throw new Error('El servidor está suspendido por falta de pago. No se puede reparar en este estado.');
  }
  if (!await claimServerRecreation(server.id)) {
    console.warn(`⏳ [Repair] Servidor ${server.name} ya está en proceso de recreación/mantenimiento. Omitiendo.`);
    return { success: false, reason: 'already_recreating' };
  }

  await logAudit(userId, 'SERVER.REPAIR.START', { serverId: server.id });
  const cachePath = path.join(server.data_path, 'cache');
  try { await fs.rm(cachePath, { recursive: true, force: true }); } catch {}

  const plan = PLAN_LIMITS[server.runtime_plan] || PLAN_LIMITS.hobby;
  try {
    await restartServerContainer(server, plan);
    await updateServerStatus(server.id, 'running');
    return { success: true };
  } catch (error) {
    await updateServerStatus(server.id, 'error');
    await logAudit(userId, 'SERVER.REPAIR.FAILED', { serverId: server.id, error: error.message });
    throw error;
  }
}

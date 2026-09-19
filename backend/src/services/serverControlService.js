import { logAudit } from '../db.js';
import { PLAN_LIMITS } from '../config.js';
import * as Docker from './dockerService.js';
import { getServerByIdForUser, getServerDetails } from './serverService.js';
import { checkSystemLoad } from './serverCreationService.js';
import { assertNodeStartCapacity } from './nodeResourcePolicy.js';
import { getPlanRamGb, resolveServerPlan } from './serverPlanPolicy.js';
import { scheduleEmbeddedTxAdminCookieRepair } from './txAdminCookieService.js';
import { restartServerContainer } from './serverRuntimeLifecycle.js';
import { claimServerRecreation, findSubuserPermissions, updateServerStatus } from '../repositories/serverRepository.js';

export async function controlServer(id, userId, action, isAdmin, options = {}) {
  const server = await getServerByIdForUser(id, userId, isAdmin);
  if (!server) throw new Error('No encontrado');
  if (['creating', 'recreating'].includes(server.status)) {
    throw new Error('El servidor todavía se está preparando. Espera a que termine antes de controlar su energía.');
  }
  if (!isAdmin && (action === 'start' || action === 'restart') && server.status === 'suspended') {
    throw new Error('El servidor está suspendido por falta de pago. Por favor, renueva tu suscripción.');
  }
  if (server.owner_id !== userId && !isAdmin) {
    const permissions = await findSubuserPermissions(server.id, userId);
    if (permissions === null) throw new Error('Acceso denegado.');
    if (!permissions.includes('power') && !permissions.includes('restart')) {
      throw new Error('No tienes permiso para controlar la energía de este servidor.');
    }
  }

  if (action === 'start') {
    checkSystemLoad();
    const allocatedRamGb = Number(server.allocated_ram_gb);
    const requiredRamGb = Number.isFinite(allocatedRamGb) && allocatedRamGb > 0
      ? allocatedRamGb
      : getPlanRamGb(resolveServerPlan(server.runtime_plan).plan);
    if (!options.maintenanceResume) await assertNodeStartCapacity(server.node_id, requiredRamGb);
    try {
      await Docker.startContainer(server.container_name, { nodeId: server.node_id });
      if (server.template === 'fivem') scheduleEmbeddedTxAdminCookieRepair(server);
      await updateServerStatus(server.id, 'running');
    } catch (error) {
      if (error.message.includes('No such container') || error.message.includes('404')) {
        console.log(`[Auto-Fix] Contenedor ${server.container_name} no encontrado al iniciar. Forzando recreación.`);
        action = 'restart';
      } else {
        throw error;
      }
    }
  }

  if (action === 'stop') {
    await updateServerStatus(server.id, 'stopping');
    try {
      await Docker.stopContainer(server.container_name, { nodeId: server.node_id });
    } catch (error) {
      console.error(`[ServerService] Error al detener contenedor ${server.container_name}: ${error.message}`);
    }
    await updateServerStatus(server.id, 'stopped');
  }

  if (action === 'restart') {
    if (!await claimServerRecreation(server.id)) {
      throw new Error('El servidor ya está en proceso de reinicio o recreación. Por favor, espera unos segundos.');
    }
    checkSystemLoad();
    const basePlan = PLAN_LIMITS[server.runtime_plan] || PLAN_LIMITS.hobby;
    const plan = server.allocated_ram_gb > 0
      ? { ...basePlan, memoryBytes: server.allocated_ram_gb * 1024 * 1024 * 1024 }
      : basePlan;
    try {
      await restartServerContainer(server, plan);
      if (server.template === 'fivem') scheduleEmbeddedTxAdminCookieRepair(server);
      await updateServerStatus(server.id, 'running');
    } catch (error) {
      await updateServerStatus(server.id, 'error');
      throw error;
    }
  }

  await logAudit(userId, `SERVER.${action.toUpperCase()}`, { serverId: server.id, serverName: server.name });
  return getServerDetails(id, userId, isAdmin);
}

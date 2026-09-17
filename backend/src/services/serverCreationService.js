import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logAudit } from '../db.js';
import { config, generateSecurePassword } from '../config.js';
import * as Docker from './dockerService.js';
import { GameFactory } from './games/GameFactory.js';
import { getPublicEndpointUrl } from './publicEndpointService.js';
import { getNextAvailablePort, selectDeploymentNode } from './serverNodeSelection.js';
import { isPortBindingConflict } from './portBindingConflict.js';
import { assertNodeStartCapacity } from './nodeResourcePolicy.js';
import { purgeServerDataDirectory } from './serverDataCleanup.js';
import { createGameDatabase, removeGameDatabase } from './gameDatabaseService.js';
import {
  attachServerToDeploymentJob,
  deleteServerRecord,
  findServerById,
  findUserDeploymentEntitlements,
  insertCreatingServer,
  listServerAllocationsByOwner,
  updateServerPorts,
  updateServerStatus
} from '../repositories/serverRepository.js';
import {
  getEffectiveServerLimit,
  getPlanRamGb,
  getPortAllocationPolicy,
  isTemplateAllowed,
  normalizeTemplateKey,
  resolveRequestedRamGb,
  resolveServerPlan
} from './serverPlanPolicy.js';

const userCreationLocks = new Map();
function excludePortBlock(excludedPorts, start, range = 1) {
  for (let offset = 0; offset < Number(range || 1); offset += 1) {
    excludedPorts.add(Number(start) + offset);
  }
}

async function removeContainerForPortRetry(nodeId, containerName) {
  try {
    const docker = await Docker.getNodeConnection(nodeId);
    await docker.getContainer(containerName).remove({ force: true });
  } catch (error) {
    if (error?.statusCode !== 404) throw error;
  }
}

export function checkSystemLoad() {
  const load = os.loadavg()[0];
  const cpuCount = Math.max(1, os.cpus()?.length || 1);
  const maxLoad = Number(process.env.SYSTEM_LOAD_LIMIT || cpuCount * 4);
  if (Number.isFinite(load) && Number.isFinite(maxLoad) && load > maxLoad) {
    throw new Error(`El sistema esta bajo carga extrema (${load.toFixed(2)}). Intentalo de nuevo en unos minutos.`);
  }
}
function sanitizeServerName(value) {
  const safeName = String(value || '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .slice(0, 80);
  if (!safeName) throw new Error('El nombre del servidor es obligatorio.');
  return safeName;
}

async function createGameContainer(template, options) {
  if (GameFactory.has(template)) return GameFactory.create(template, options);

  switch (template) {
    case 'palworld': return Docker.createPalworldContainer(options);
    case 'cs2': return Docker.createCS2Container(options);
    case 'valheim': return Docker.createValheimContainer(options);
    case 'zomboid': return Docker.createProjectZomboidContainer(options);
    case 'ark': return Docker.createARKContainer(options);
    case 'sdtd':
      return Docker.createSDTDContainer(
        options.containerName,
        options.serverId,
        options.gamePort,
        options.plan,
        options.dataPath,
        options.nodeId
      );
    case 'discordbot': return Docker.createDiscordBotContainer(options);
    case 'wordpress': return Docker.createWordPressContainer(options);
    case 'database': return Docker.createDatabaseContainer(options);
    default: throw new Error(`Tipo de servidor no soportado: ${template}.`);
  }
}

async function rollbackCreation({ serverId, containerName, dataPath, nodeId, dbName, dbUser }) {
  try {
    const docker = await Docker.getNodeConnection(nodeId);
    await docker.getContainer(containerName).remove({ force: true });
  } catch (error) {
    if (error?.statusCode !== 404) console.warn(`[Rollback] No se pudo retirar ${containerName}: ${error.message}`);
  }

  try {
    const docker = await Docker.getNodeConnection(nodeId);
    await docker.getContainer(`${containerName}-db`).remove({ force: true });
  } catch (error) {
    if (error?.statusCode !== 404) console.warn(`[Rollback] No se pudo retirar ${containerName}-db: ${error.message}`);
  }

  try {
    await purgeServerDataDirectory(nodeId, serverId, dataPath);
  } catch (error) {
    console.warn(`[Rollback] No se pudo retirar ${dataPath}: ${error.message}`);
  }

  if (dbName && dbUser) {
    try {
      await removeGameDatabase(dbName, dbUser);
    } catch (error) {
      console.warn(`[Rollback] No se pudo retirar la base de datos ${dbName}: ${error.message}`);
    }
  }

  try {
    await deleteServerRecord(serverId);
  } catch (error) {
    console.warn(`[Rollback] No se pudo retirar el registro ${serverId}: ${error.message}`);
  }
}

export async function createServerForUser(userId, payload = {}) {
  if (userCreationLocks.get(userId)) {
    throw new Error('Ya tienes una creacion de servidor en progreso. Espera a que termine.');
  }
  userCreationLocks.set(userId, true);

  try {
    checkSystemLoad();
    const user = await findUserDeploymentEntitlements(userId);
    if (!user) throw new Error('Usuario no encontrado.');
    const { key: assignedPlan, plan } = resolveServerPlan(user.plan);
    const template = normalizeTemplateKey(payload.template || 'fivem');
    if (!isTemplateAllowed(plan, template)) {
      throw new Error(`Tu plan actual (${assignedPlan.toUpperCase()}) no permite servidores de ${template.toUpperCase()}.`);
    }

    const effectiveServerLimit = getEffectiveServerLimit(
      user.server_limit,
      plan,
      config.serverLimitPerUser
    );
    const currentServers = await listServerAllocationsByOwner(userId);
    if (currentServers.length >= effectiveServerLimit) {
      throw new Error(`Limite alcanzado: tu plan (${assignedPlan.toUpperCase()}) permite ${effectiveServerLimit} servidor(es).`);
    }

    const currentAllocatedRamGb = currentServers.reduce((total, server) => {
      const allocated = Number(server.allocated_ram_gb);
      if (Number.isFinite(allocated) && allocated > 0) return total + allocated;
      return total + getPlanRamGb(resolveServerPlan(server.runtime_plan).plan);
    }, 0);
    const requestedRamGb = resolveRequestedRamGb(payload.allocatedRamGb, plan, template);
    const maxPlanRamGb = getPlanRamGb(plan);
    if (currentAllocatedRamGb + requestedRamGb > maxPlanRamGb) {
      throw new Error(`Recursos insuficientes: el plan ${assignedPlan.toUpperCase()} dispone de ${maxPlanRamGb} GB de RAM; usas ${currentAllocatedRamGb} GB y solicitas ${requestedRamGb} GB.`);
    }

    const extraDiskGb = Number(user.extra_disk_gb || 0);
    if (template === 'cs2' && assignedPlan === 'standard' && extraDiskGb <= 30) {
      throw new Error('El plan STANDARD requiere una expansion de disco superior a 30 GB para desplegar CS2.');
    }

    const safeName = sanitizeServerName(payload.serverName ?? payload.name);
    const customPlan = { ...plan, memoryBytes: requestedRamGb * 1024 ** 3 };
    const targetNode = await selectDeploymentNode(
      customPlan,
      requestedRamGb,
      template,
      payload.nodeId ?? payload.explicitNodeId,
      payload.capacityReserved ? requestedRamGb : 0
    );
    const targetNodeId = Number(targetNode.id);
    await assertNodeStartCapacity(targetNodeId, requestedRamGb);
    const portPolicy = getPortAllocationPolicy(template, config);
    const excludedPorts = new Set();
    const reservedPorts = payload.capacityReserved ? payload.reservedPorts : null;
    let gamePort = Number(reservedPorts?.gamePort)
      || await getNextAvailablePort(portPolicy.start, portPolicy.range, targetNodeId, excludedPorts);
    let txAdminPort = Number(reservedPorts?.adminPort) || (portPolicy.adminStart
      ? await getNextAvailablePort(portPolicy.adminStart, 1, targetNodeId, excludedPorts)
      : gamePort);
    let blenderPort = Number(reservedPorts?.blenderPort)
      || await getNextAvailablePort(config.blenderPortStart, 1, targetNodeId, excludedPorts);

    const serverId = uuidv4();
    const shortId = serverId.slice(0, 8);
    const containerName = `ragenodes-${shortId}`;
    const dataPath = path.join(config.instanceDataRoot, serverId);
    const slug = `${safeName.toLowerCase().replace(/\s+/g, '-')}-${shortId}`;
    const licenseKey = String(payload.licenseKey || '').trim();
    if (template === 'fivem' && (!licenseKey || /^(?:change[_-]?me|hidden|example)$/i.test(licenseKey))) {
      throw new Error('FiveM requiere una clave de licencia Cfx.re valida antes del despliegue.');
    }
    const licenseKeyHint = licenseKey ? `***${licenseKey.slice(-4)}` : 'not-required';
    let txAdminUrl = getPublicEndpointUrl(template === 'fivem' ? txAdminPort : gamePort, { path: '' });
    const blenderPass = generateSecurePassword();
    const needsMariaDatabase = template === 'fivem' || template === 'ark';
    const dbName = needsMariaDatabase ? `${template}_${shortId}` : null;
    const dbUser = needsMariaDatabase ? `usr_${shortId}` : null;
    const dbPass = needsMariaDatabase ? generateSecurePassword() : null;

    try {
      if (needsMariaDatabase) await createGameDatabase(dbName, dbUser, dbPass);

      await insertCreatingServer({
        id: serverId, ownerId: userId, name: safeName, slug, template,
        runtimePlan: assignedPlan, cpuset: payload.cpuset || null, gamePort,
        txAdminPort, blenderPort, blenderPass, containerName, dataPath,
        licenseKeyHint, txAdminUrl, dbName, dbUser, dbPass, nodeId: targetNodeId,
        expiresAt: user.expires_at || null,
        mcVersion: payload.mcVersion || payload.mc_version || '1.21.4',
        mcType: payload.mcType || payload.mc_type || 'PAPER',
        allocatedRamGb: requestedRamGb
      });
      if (payload.deploymentJobId) {
        await attachServerToDeploymentJob(payload.deploymentJobId, serverId);
      }

      const configuredRetryLimit = Number(process.env.PORT_BIND_RETRY_LIMIT || 8);
      const retryLimit = Number.isInteger(configuredRetryLimit) && configuredRetryLimit > 0
        ? Math.min(20, configuredRetryLimit)
        : 8;
      for (let attempt = 1; attempt <= retryLimit; attempt += 1) {
        try {
          await createGameContainer(template, {
            containerName,
            dataPath,
            gamePort,
            fivemPort: gamePort,
            txadminPort: txAdminPort,
            serverId,
            serverName: safeName,
            licenseKey,
            plan: customPlan,
            dbName,
            dbUser,
            dbPass,
            nodeId: targetNodeId,
            mcVersion: payload.mcVersion || payload.mc_version || '1.21.4',
            mcType: payload.mcType || payload.mc_type || 'PAPER',
            maxPlayers: Number(payload.maxPlayers || 20),
            cpuset: payload.cpuset || null
          });
          break;
        } catch (error) {
          if (!isPortBindingConflict(error) || attempt >= retryLimit) throw error;

          await removeContainerForPortRetry(targetNodeId, containerName);
          excludePortBlock(excludedPorts, gamePort, portPolicy.range);
          excludePortBlock(excludedPorts, txAdminPort, 1);
          excludePortBlock(excludedPorts, blenderPort, 1);

          gamePort = await getNextAvailablePort(portPolicy.start, portPolicy.range, targetNodeId, excludedPorts);
          txAdminPort = portPolicy.adminStart
            ? await getNextAvailablePort(portPolicy.adminStart, 1, targetNodeId, excludedPorts)
            : gamePort;
          blenderPort = await getNextAvailablePort(config.blenderPortStart, 1, targetNodeId, excludedPorts);
          txAdminUrl = getPublicEndpointUrl(template === 'fivem' ? txAdminPort : gamePort, { path: '' });
          await updateServerPorts(serverId, { gamePort, txAdminPort, blenderPort, txAdminUrl });
          console.warn(`[ServerCreation] Puerto ocupado en el nodo ${targetNodeId}; reintento ${attempt + 1}/${retryLimit}.`);
        }
      }
      await updateServerStatus(serverId, 'running');
    } catch (error) {
      console.error(`[ServerCreation] Fallo al crear ${serverId}; iniciando rollback:`, error);
      await rollbackCreation({ serverId, containerName, dataPath, nodeId: targetNodeId, dbName, dbUser });
      throw new Error('No se pudo iniciar el servidor. La operacion se revirtio de forma segura.');
    }

    await logAudit(userId, 'server.create', {
      serverId,
      serverName: safeName,
      plan: assignedPlan,
      template,
      nodeId: targetNodeId,
      allocatedRamGb: requestedRamGb
    });
    return findServerById(serverId);
  } finally {
    userCreationLocks.delete(userId);
  }
}

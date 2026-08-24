import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import mysql from 'mysql2/promise';
import { query, logAudit } from '../db.js';
import { config, generateSecurePassword } from '../config.js';
import * as Docker from './dockerService.js';
import { GameFactory } from './games/GameFactory.js';
import { getPublicEndpointUrl } from './publicEndpointService.js';
import { getNextAvailablePort, selectDeploymentNode } from './serverNodeSelection.js';
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

function checkSystemLoad() {
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

async function createMariaDatabase(dbName, dbUser, dbPass) {
  const connection = await mysql.createConnection({
    host: process.env.MARIADB_HOST || 'mariadb',
    user: 'root',
    password: config.centralDbPass,
    port: Number(process.env.MARIADB_PORT || 3306)
  });
  try {
    const escapedDatabase = mysql.escapeId(dbName);
    const escapedUser = mysql.escape(dbUser);
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${escapedDatabase} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`CREATE USER IF NOT EXISTS ${escapedUser}@'%' IDENTIFIED BY ?`, [dbPass]);
    await connection.query(`GRANT ALL PRIVILEGES ON ${escapedDatabase}.* TO ${escapedUser}@'%'`);
    await connection.query('FLUSH PRIVILEGES');
  } finally {
    await connection.end();
  }
}

async function removeMariaDatabase(dbName, dbUser) {
  const connection = await mysql.createConnection({
    host: process.env.MARIADB_HOST || 'mariadb',
    user: 'root',
    password: config.centralDbPass,
    port: Number(process.env.MARIADB_PORT || 3306)
  });
  try {
    await connection.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(dbName)}`);
    await connection.query(`DROP USER IF EXISTS ${mysql.escape(dbUser)}@'%'`);
  } finally {
    await connection.end();
  }
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
    await Docker.runRemoteCommand(nodeId, Docker.sh`rm -rf -- ${dataPath}`);
  } catch (error) {
    console.warn(`[Rollback] No se pudo retirar ${dataPath}: ${error.message}`);
  }

  if (dbName && dbUser) {
    try {
      await removeMariaDatabase(dbName, dbUser);
    } catch (error) {
      console.warn(`[Rollback] No se pudo retirar la base de datos ${dbName}: ${error.message}`);
    }
  }

  try {
    await query('DELETE FROM servers WHERE id = $1', [serverId]);
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
    const userResult = await query(
      'SELECT plan, server_limit, extra_disk_gb, expires_at FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) throw new Error('Usuario no encontrado.');

    const user = userResult.rows[0];
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
    const { rows: currentServers } = await query(
      'SELECT id, runtime_plan, allocated_ram_gb FROM servers WHERE owner_id = $1',
      [userId]
    );
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
      payload.nodeId ?? payload.explicitNodeId
    );
    const targetNodeId = Number(targetNode.id);
    const portPolicy = getPortAllocationPolicy(template, config);
    const gamePort = await getNextAvailablePort(portPolicy.start, portPolicy.range, targetNodeId);
    const txAdminPort = portPolicy.adminStart
      ? await getNextAvailablePort(portPolicy.adminStart, 1, targetNodeId)
      : gamePort;
    const blenderPort = await getNextAvailablePort(config.blenderPortStart, 1, targetNodeId);

    const serverId = uuidv4();
    const shortId = serverId.slice(0, 8);
    const containerName = `ragenodes-${shortId}`;
    const dataPath = path.join(config.instanceDataRoot, serverId);
    const slug = `${safeName.toLowerCase().replace(/\s+/g, '-')}-${shortId}`;
    const licenseKey = String(payload.licenseKey || 'changeme');
    const licenseKeyHint = licenseKey === 'changeme' ? 'hidden' : `***${licenseKey.slice(-4)}`;
    const txAdminUrl = getPublicEndpointUrl(template === 'fivem' ? txAdminPort : gamePort, { path: '' });
    const blenderPass = generateSecurePassword();
    const needsMariaDatabase = template === 'fivem' || template === 'ark';
    const dbName = needsMariaDatabase ? `${template}_${shortId}` : null;
    const dbUser = needsMariaDatabase ? `usr_${shortId}` : null;
    const dbPass = needsMariaDatabase ? generateSecurePassword() : null;

    try {
      if (needsMariaDatabase) await createMariaDatabase(dbName, dbUser, dbPass);

      await query(
        `INSERT INTO servers (
          id, owner_id, name, slug, template, runtime_plan, cpuset, status,
          fivem_port, txadmin_port, blender_port, blender_pass,
          container_name, data_path, license_key_hint, txadmin_url,
          db_name, db_user, db_pass, node_id, expires_at, mc_version, mc_type,
          allocated_ram_gb
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, 'creating',
          $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22, $23
        )`,
        [
          serverId, userId, safeName, slug, template, assignedPlan, payload.cpuset || null,
          gamePort, txAdminPort, blenderPort, blenderPass,
          containerName, dataPath, licenseKeyHint, txAdminUrl,
          dbName, dbUser, dbPass, targetNodeId, user.expires_at || null,
          payload.mcVersion || payload.mc_version || 'LATEST',
          payload.mcType || payload.mc_type || 'PAPER',
          requestedRamGb
        ]
      );

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
        mcVersion: payload.mcVersion || payload.mc_version || 'LATEST',
        mcType: payload.mcType || payload.mc_type || 'PAPER',
        maxPlayers: Number(payload.maxPlayers || 20),
        cpuset: payload.cpuset || null
      });
      await query("UPDATE servers SET status = 'running' WHERE id = $1", [serverId]);
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
    return (await query('SELECT * FROM servers WHERE id = $1', [serverId])).rows[0];
  } finally {
    userCreationLocks.delete(userId);
  }
}

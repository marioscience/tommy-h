import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, queryCached, logAudit } from '../db.js';
import { config, PLAN_LIMITS, generateSecurePassword } from '../config.js';
import * as Docker from './dockerService.js';
import { execFile } from 'child_process';
import { updateTunnelConfig, updateServerTunnelConfig, cleanOrphanedTunnels, getRagenodesTunnelHostname } from './cloudflareService.js';
import { GameFactory } from './games/GameFactory.js';
import { sendTeamInviteEmail } from './emailService.js';
import os from 'os';
import net from 'net';
import dgram from 'dgram';
import util from 'util';

const repairBackoffCache = new Map();
const MAX_REPAIRS_PER_HOUR = 3;

function shouldRepairWithBackoff(serverId) {
    const now = Date.now();
    const records = repairBackoffCache.get(serverId) || [];
    const recentRecords = records.filter(t => now - t < 3600000);
    if (recentRecords.length >= MAX_REPAIRS_PER_HOUR) {
        return false;
    }
    recentRecords.push(now);
    repairBackoffCache.set(serverId, recentRecords);
    return true;
}

function verifyServerPort(ip, port, type) {
    return new Promise((resolve) => {
        const timeout = 3000;
        let resolved = false;

        if (type === 'tcp') {
            const socket = new net.Socket();
            socket.setTimeout(timeout);
            socket.on('connect', () => {
                if (!resolved) { resolved = true; socket.destroy(); resolve(true); }
            });
            socket.on('timeout', () => {
                if (!resolved) { resolved = true; socket.destroy(); resolve(false); }
            });
            socket.on('error', () => {
                if (!resolved) { resolved = true; socket.destroy(); resolve(false); }
            });
            socket.connect(port, ip);
        } else {
            resolve(true); // UDP fallback
        }
    });
}

const execFilePromise = util.promisify(execFile);

// 🧠 TRACKER DE ACTIVIDAD PARA ENTORNOS 3D (Auto-apagado por inactividad)
const blenderActivity = new Map();
const BLENDER_INACTIVITY_MS = 30 * 60 * 1000; // 30 minutos

// 🔥 PLANES: Importados desde config.js como fuente única de verdad.
const PLANS = Object.entries(PLAN_LIMITS).reduce((acc, [key, val]) => {
  const diskBytes = val.diskBytes || ((val.diskGb || 20) * 1024 ** 3);
  acc[key] = {
    ...val,
    diskBytes,
    storageLimit: val.storageLimit || `${Math.round(diskBytes / 1024 ** 3)}G`,
    allowedTemplates: val.allowedTemplates || ['minecraft', 'fivem']
  };
  return acc;
}, {});
const DOCKER_QUERY_CHUNK_SIZE = Math.max(1, Number(process.env.DOCKER_QUERY_CHUNK_SIZE || 5));
const MAINTENANCE_CHUNK_SIZE = Math.max(1, Number(process.env.MAINTENANCE_CHUNK_SIZE || 3));
const MAINTENANCE_INTERVAL_MS = Math.max(300000, Number(process.env.MAINTENANCE_INTERVAL_MS || 600000)); // 10 minutes default

// 🧠 CACHE DE TAMAÑO DE DISCO (Para no saturar I/O)
const diskSizeCache = new Map();
const DISK_CACHE_TTL = 60 * 1000; // 1 minuto
const inflightDiskRequests = new Map(); // Para evitar escaneos simultáneos de la misma carpeta

// Función optimizada con Rust, Caché y Promesas In-Flight.
// Los listados usan stale-while-revalidate para no bloquear requests con escaneos de disco.
function refreshFolderSize(dirPath) {
    if (!dirPath || inflightDiskRequests.has(dirPath)) return inflightDiskRequests.get(dirPath);

    const promise = rustUtil.getDirSize(dirPath).then(size => {
        diskSizeCache.set(dirPath, { size, time: Date.now() });
        inflightDiskRequests.delete(dirPath);
        return size;
    }).catch(err => {
        inflightDiskRequests.delete(dirPath);
        console.warn(`[DiskCache] No se pudo calcular tamaño de ${dirPath}:`, err.message);
        return diskSizeCache.get(dirPath)?.size || 0;
    });

    inflightDiskRequests.set(dirPath, promise);
    return promise;
}

async function getFolderSize(dirPath) {
    const cached = diskSizeCache.get(dirPath);
    if (cached && (Date.now() - cached.time < DISK_CACHE_TTL)) return cached.size;
    return refreshFolderSize(dirPath);
}

function getFolderSizeSnapshot(dirPath) {
    const cached = diskSizeCache.get(dirPath);
    if (!cached || (Date.now() - cached.time >= DISK_CACHE_TTL)) {
        refreshFolderSize(dirPath);
    }
    return cached?.size || 0;
}

// 🛡️ CONTROL DE CONGESTIÓN: evita saturar la VPS usando un límite proporcional a las vCPU.
function checkSystemLoad() {
    const load = os.loadavg()[0];
    const cpuCount = Math.max(1, os.cpus()?.length || 1);
    const maxLoad = Number(process.env.SYSTEM_LOAD_LIMIT || cpuCount * 4);

    if (load > maxLoad) {
        throw new Error(`El sistema está bajo carga extrema (Load: ${load.toFixed(2)} / Límite: ${maxLoad.toFixed(2)}). Por favor, espera unos minutos antes de realizar esta operación para evitar inestabilidad en la VPS.`);
    }
}

async function getNodeRuntimeUsage() {
  const { rows } = await query(`
    SELECT COALESCE(node_id, 0) AS node_id,
           COALESCE(SUM(allocated_ram_gb), 0)::int AS allocated_ram_gb,
           COUNT(*)::int AS running_servers
    FROM servers
    WHERE status = 'running'
    GROUP BY COALESCE(node_id, 0)
  `);
  return new Map(rows.map(row => [Number(row.node_id), {
    allocatedRamGb: Number(row.allocated_ram_gb || 0),
    runningServers: Number(row.running_servers || 0)
  }]));
}

async function nodeCanAcceptDockerWorkload(node) {
  try {
    const docker = await Docker.getNodeConnection(node.id);
    await docker.ping();
    return true;
  } catch (err) {
    console.warn(`[NodeBalancer] Nodo ${node.id} no responde a Docker: ${err.message}`);
    return false;
  }
}

async function selectDeploymentNode(plan, requestedRamGb, template, explicitNodeId = null) {
  const requestedNode = explicitNodeId ?? process.env.FORCE_NODE_ID;
  if (requestedNode !== null && requestedNode !== undefined && requestedNode !== '') {
    const id = Number(requestedNode);
    const { rows } = await query('SELECT * FROM nodes WHERE id = $1 AND status = \'active\'', [id]);
    if (!rows.length) throw new Error(`Nodo ${id} no existe o no est?? activo.`);
    if (!(await nodeCanAcceptDockerWorkload(rows[0]))) throw new Error(`Nodo ${id} no est?? disponible para Docker.`);
    return id;
  }

  const requiredRamGb = Math.max(1, Number(requestedRamGb || 1));
  const requiredCpu = Math.max(1, Math.ceil(Number(plan?.nanoCpus || 0) / 1e9));
  const usage = await getNodeRuntimeUsage();
  const { rows: nodes } = await query('SELECT * FROM nodes WHERE status = \'active\' ORDER BY id');
  const candidates = [];

  for (const node of nodes) {
    const nodeId = Number(node.id);
    if (!(await nodeCanAcceptDockerWorkload(node))) continue;
    const used = usage.get(nodeId) || { allocatedRamGb: 0, runningServers: 0 };
    const ramTotal = Number(node.ram_total_gb || (nodeId === 0 ? Math.round(os.totalmem() / (1024 ** 3)) : 0));
    const cpuTotal = Number(node.cpu_cores || (nodeId === 0 ? os.cpus().length : 0));
    const ramHeadroom = Math.max(0, ramTotal - used.allocatedRamGb);
    if (ramHeadroom < requiredRamGb) continue;
    if (cpuTotal && requiredCpu > cpuTotal) continue;
    candidates.push({
      id: nodeId,
      score: (ramHeadroom * 10) + (cpuTotal || 0) - (used.runningServers * 2) + (nodeId === 0 ? 0 : 25),
      ramHeadroom,
      runningServers: used.runningServers
    });
  }

  console.log(`[DEBUG selectDeploymentNode] requestedRamGb=${requestedRamGb}, template=${template}, nodes.length=${nodes?.length}, candidates.length=${candidates?.length}`);
  if (!candidates.length) {
    if (nodes && nodes.length > 0) return nodes[0].id;
    throw new Error(`No hay nodos activos con recursos suficientes para ${template.toUpperCase()} (${requiredRamGb} GB RAM).`);
  }

  candidates.sort((a, b) => b.score - a.score);
  console.log(`[NodeBalancer] ${template} -> nodo ${candidates[0].id} (RAM libre estimada ${candidates[0].ramHeadroom}GB, servidores ${candidates[0].runningServers})`);
  return candidates[0].id;
}


export async function getServersForUser(userId, isAdmin = false) {
  const sql = isAdmin ? 'SELECT servers.*, users.extra_disk_gb FROM servers LEFT JOIN users ON servers.owner_id = users.id ORDER BY servers.created_at DESC' : 'SELECT servers.*, users.extra_disk_gb FROM servers LEFT JOIN users ON servers.owner_id = users.id WHERE servers.owner_id = $1 OR servers.id IN (SELECT server_id FROM server_subusers WHERE user_id = $1) ORDER BY servers.created_at DESC';
  const servers = (await queryCached(sql, isAdmin ? [] : [userId], 3)).rows;

  // Lotes (chunks) para no saturar Docker con Promesas concurrentes masivas
  const CHUNK_SIZE = DOCKER_QUERY_CHUNK_SIZE;
  for (let i = 0; i < servers.length; i += CHUNK_SIZE) {
      const chunk = servers.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(async (s) => {
         const shortId = s.id.slice(0,8);

         if (s.template === 'ark' && !s.db_name) {
             console.warn(`[ServersList] ARK ${s.name} no tiene credenciales DB; omitiendo autocreación en request de lectura.`);
         }

         const [bState, state] = await Promise.all([
             Docker.resolveContainerState(`ragenodes-blender-${shortId}`),
             Docker.resolveContainerState(s.container_name),
         ]);
         const usedDiskBytes = getFolderSizeSnapshot(s.data_path);

         s.blender_status = bState.running ? 'running' : 'stopped';
         delete s.blender_pass;
         if (!isAdmin && s.owner_id !== userId) {
             delete s.db_name;
             delete s.db_user;
             delete s.db_pass;
             delete s.discord_webhook_url;
             delete s.data_path;
             delete s.container_name;
             delete s.license_key_hint;
             delete s.subuser_permissions;
         }
         s.status = !state.exists ? 'missing' : (state.running ? 'running' : 'stopped');

         const plan = PLANS[s.runtime_plan] || PLANS.hobby;
         const maxDisk = (plan.diskBytes || (20 * 1024 ** 3)) + ((s.extra_disk_gb || 0) * 1024 ** 3);
         const diskPercent = Math.min(((usedDiskBytes / maxDisk) * 100), 100);
         const diskGb = usedDiskBytes / (1024 ** 3);

         if (s.status === 'running') {
             s.stats = await Docker.getContainerStats(s.container_name);
             s.stats.disk = diskPercent;
             s.stats.diskGb = diskGb;
         } else {
             s.stats = { cpu: 0, ram: 0, ramGb: 0, disk: diskPercent, diskGb: diskGb };
         }
      }));
  }

  return servers;
}

export async function getServerByIdForUser(id, userId, isAdmin = false, requiredPermission = null) {
  const sql = isAdmin
    ? 'SELECT servers.*, users.extra_disk_gb FROM servers LEFT JOIN users ON servers.owner_id = users.id WHERE servers.id = $1'
    : `SELECT servers.*, users.extra_disk_gb, su.permissions AS subuser_permissions
       FROM servers
       LEFT JOIN users ON servers.owner_id = users.id
       LEFT JOIN server_subusers su ON su.server_id = servers.id AND su.user_id = $2
       WHERE servers.id = $1 AND (servers.owner_id = $2 OR su.user_id = $2)`;
  const server = (await queryCached(sql, isAdmin ? [id] : [id, userId], 2)).rows[0];
  if (!server || isAdmin || server.owner_id === userId || !requiredPermission) return server;

  const permissions = Array.isArray(server.subuser_permissions) ? server.subuser_permissions : [];
  return permissions.includes(requiredPermission) ? server : undefined;
}

async function getNextAvailablePort(startPort, range = 1, targetNodeId = 0) {
    const nodeOffset = Number(targetNodeId) * 1000;
    startPort = startPort + nodeOffset + (config.portBaseOffset || 0);

    const maxScan = Number(process.env.PORT_SCAN_LIMIT || 5000);
    const endPort = Math.min(65535, startPort + maxScan);
  if (!Number.isInteger(startPort) || startPort <= 0 || startPort > 65535) {
    throw new Error(`Puerto inicial inválido: ${startPort}`);
  }
  if (!Number.isInteger(range) || range <= 0 || startPort + range - 1 > 65535) {
    throw new Error(`Rango de puertos inválido: inicio=${startPort}, rango=${range}`);
  }

  const { rows } = await query(`
    SELECT fivem_port as port FROM servers WHERE fivem_port IS NOT NULL
    UNION
    SELECT txadmin_port as port FROM servers WHERE txadmin_port IS NOT NULL
    UNION
    SELECT blender_port as port FROM servers WHERE blender_port IS NOT NULL
  `);
  const usedPorts = new Set(rows.map(r => Number(r.port)).filter(Boolean));

  try {
      const containers = await Docker.localDocker.listContainers();
      for (const c of containers) {
          if (c.Ports) {
              for (const p of c.Ports) {
                  if (p.PublicPort) usedPorts.add(Number(p.PublicPort));
              }
          }
      }
  } catch (e) {
      console.warn('[Ports] No se pudieron leer puertos publicados desde Docker:', e.message);
  }

  for (let port = startPort; port + range - 1 <= endPort; port++) {
    let blockFree = true;
    for (let i = 0; i < range; i++) {
        if (usedPorts.has(port + i)) {
            blockFree = false;
            break;
        }
    }
    if (blockFree) return port;
  }

  throw new Error(`No hay puertos disponibles entre ${startPort} y ${endPort} para un bloque de ${range}. Libera puertos o amplía PORT_SCAN_LIMIT.`);
}

const userCreationLocks = new Map();

export async function createServerForUser(userId, payload) {
  if (userCreationLocks.get(userId)) {
      throw new Error("Ya tienes una creación de servidor en progreso. Por favor, espera a que termine.");
  }
  userCreationLocks.set(userId, true);

  try {
    checkSystemLoad();
    try {
      const fsSync = await import('fs');
      if (fsSync.existsSync('/tmp/crash_backend')) {
        fsSync.unlinkSync('/tmp/crash_backend');
        console.log("💀 CRASH SOLICITADO PARA REINICIO...");
        process.exit(1);
      }
    } catch(e) {}
  const userResult = await query('SELECT plan, server_limit, extra_disk_gb, expires_at FROM users WHERE id = $1', [userId]);
  let assignedPlan = 'hobby';
  let serverLimit = config.serverLimitPerUser;
  let extraDiskGb = 0;
  let expireDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // fallback

  if (userResult.rows.length > 0) {
      assignedPlan = (userResult.rows[0].plan || 'hobby').toLowerCase();
      serverLimit = userResult.rows[0].server_limit || config.serverLimitPerUser;
      extraDiskGb = userResult.rows[0].extra_disk_gb || 0;
      expireDate = userResult.rows[0].expires_at; // Hereda la caducidad del usuario (puede ser null/ilimitado)
  }

  const template = (payload.template || "fivem").toLowerCase();
  const plan = PLANS[assignedPlan];

  const isAllowed = plan && plan.allowedTemplates && plan.allowedTemplates.includes(template);
  if (!isAllowed) {
      throw new Error(`Tu plan actual (${assignedPlan.toUpperCase()}) no tiene acceso a servidores de ${template.toUpperCase()}. Por favor, mejora tu suscripción.`);
  }

  // 🚀 FASE 1: VALIDACIÓN INTELIGENTE DE BOLSA DE RECURSOS (Slots + RAM)
  const effectiveMaxSlots = Math.max(plan?.maxSlots || 1, serverLimit || 1);
  const { rows: currentServers } = await query('SELECT id, allocated_ram_gb FROM servers WHERE owner_id = $1', [userId]);

  if (currentServers.length >= effectiveMaxSlots) {
      throw new Error(`Has alcanzado el límite máximo de ${effectiveMaxSlots} servidores (Slots) permitidos en tu plan actual (${assignedPlan.toUpperCase()}).`);
  }

  let currentAllocatedRamGb = 0;
  for (const s of currentServers) {
      currentAllocatedRamGb += (s.allocated_ram_gb > 0) ? s.allocated_ram_gb : Math.round((plan?.memoryBytes || 4*1024**3) / (1024**3));
  }

  const TEMPLATE_MIN_RAM_GB = {
      'zomboid': 4,
      'rust': 4,
      'palworld': 8,
      'minecraft': 2,
      'fivem': 1,
      'cs2': 2
  };

  const templateMinRam = TEMPLATE_MIN_RAM_GB[template] || 1;
  const planMinRamGb = plan?.minRamGb || 1;
  const minRamGb = Math.max(planMinRamGb, templateMinRam);
  const requestedRamGb = payload.allocatedRamGb ? Number(payload.allocatedRamGb) : minRamGb;

  if (requestedRamGb < minRamGb) {
      throw new Error(`Para garantizar la estabilidad del servidor de ${template.toUpperCase()}, se requiere una asignación mínima de ${minRamGb} GB de RAM. Has solicitado ${requestedRamGb} GB.`);
  }

  const maxPlanRamGb = Math.round((plan?.memoryBytes || 4*1024**3) / (1024**3));
  if (currentAllocatedRamGb + requestedRamGb > maxPlanRamGb) {
      throw new Error(`¡Recursos Insuficientes en tu Bolsa! Tu plan actual (${assignedPlan.toUpperCase()}) tiene un límite de ${maxPlanRamGb} GB de RAM. Actualmente usas ${currentAllocatedRamGb} GB y estás solicitando ${requestedRamGb} GB para este nuevo servidor.`);
  }

  // Ajustamos el objeto plan con la memoria personalizada solicitada para pasárselo a Docker
  const customPlan = plan ? { ...plan, memoryBytes: requestedRamGb * 1024 * 1024 * 1024 } : null;
  const targetNodeId = await selectDeploymentNode(customPlan || plan, requestedRamGb, template, payload.nodeId);

  // 🛡️ RESTRICCIÓN DE CS2 EN PLAN STANDARD: Requiere plan de expansión > 30 GB
  if (template === 'cs2' && assignedPlan === 'standard') {
      if (extraDiskGb <= 30) {
          throw new Error("El plan STANDARD requiere tener contratado un plan de expansión de disco mayor a 30 GB para poder desplegar Counter-Strike 2. Por favor, adquiere una expansión de almacenamiento en la tienda.");
      }
  }

  const isMinecraft = template === 'minecraft';
  const isRust = template === 'rust';
  const isPalworld = template === 'palworld';
  const isCS2 = template === 'cs2';
  const isValheim = template === 'valheim';
  const isZomboid = template === 'zomboid';
  const isARK = template === 'ark';
  const isSDTD = template === 'sdtd';
  const isDiscordBot = template === 'discordbot';
  const isWordPress = template === 'wordpress';
  const isDatabase = template === 'database';
  const isNonFivem = isMinecraft || isRust || isPalworld || isCS2 || isValheim || isZomboid || isARK || isSDTD || isDiscordBot || isWordPress || isDatabase;

  const serverId = uuidv4();
  const cName = `ragenodes-${serverId.slice(0,8)}`;

  // Asignación inteligente de puertos
  let fPort, tPort, bPort;
  if (isMinecraft) {
    fPort = await getNextAvailablePort(config.minecraftPortStart, 1, targetNodeId);
    tPort = fPort;
  } else if (isRust) {
    fPort = await getNextAvailablePort(config.rustPortStart, 3, targetNodeId);
    tPort = fPort;
  } else if (isPalworld) {
    fPort = await getNextAvailablePort(config.palworldPortStart, 3, targetNodeId);
    tPort = fPort;
  } else if (isCS2) {
    fPort = await getNextAvailablePort(config.cs2PortStart, 1, targetNodeId);
    tPort = fPort;
  } else if (isValheim) {
    fPort = await getNextAvailablePort(config.valheimPortStart, 3, targetNodeId);
    tPort = fPort;
  } else if (isSDTD) {
    fPort = await getNextAvailablePort(config.sdtdPortStart, 4, targetNodeId);
    tPort = fPort;
  } else if (isZomboid) {
    fPort = await getNextAvailablePort(config.zomboidPortStart, 2, targetNodeId);
    tPort = fPort;
  } else if (isARK) {
    // 🦕 Verificar requisitos mínimos de ARK antes de asignar puerto
    const { checkArkRequirements } = await import('./arkService.js');
    const reqCheck = checkArkRequirements(assignedPlan);
    if (!reqCheck.passed) {
      const fails = Object.entries(reqCheck.checks)
        .filter(([,v]) => !v.ok)
        .map(([,v]) => `${v.have}/${v.need} ${v.unit}`)
        .join(', ');
      throw new Error(`Tu plan no cumple los requisitos mínimos para ARK: Survival Ascended. Insuficiente: ${fails}. Necesitas el plan ARK Dedicado.`);
    }
    fPort = await getNextAvailablePort(config.arkPortStart, 14, targetNodeId); // Game, Query (+1), RCON (+13)
    tPort = fPort;
  } else if (isDiscordBot || isWordPress || isDatabase) {
    fPort = await getNextAvailablePort(config.appPortStart || 8000, 1, targetNodeId);
    tPort = fPort;
  } else {
    fPort = await getNextAvailablePort(config.fivemPortStart, 1, targetNodeId);
    tPort = await getNextAvailablePort(config.txAdminPortStart, 1, targetNodeId);
  }
  bPort = await getNextAvailablePort(config.blenderPortStart, 1, targetNodeId);

  let dbName = null, dbUser = null, dbPass = null;

  if (!isNonFivem || isARK) {
    const prefix = isARK ? 'ark' : 'fivem';
    dbName = `${prefix}_${serverId.slice(0,8).replace(/-/g, '_')}`;
    dbUser = `usr_${serverId.slice(0,8)}`;
    dbPass = generateSecurePassword();
    try {
        const dbConnection = await mysql.createConnection({
            host: 'mariadb', user: 'root', password: config.centralDbPass
        });
        const escapedDbName = mysql.escapeId(dbName);
        await dbConnection.query(`CREATE DATABASE IF NOT EXISTS ${escapedDbName}`);
        await dbConnection.query(`CREATE USER IF NOT EXISTS ?@'%' IDENTIFIED BY ?`, [dbUser, dbPass]);
        await dbConnection.query(`GRANT ALL PRIVILEGES ON ${escapedDbName}.* TO ?@'%'`, [dbUser]);
        await dbConnection.query(`FLUSH PRIVILEGES`);
        await dbConnection.end();
    } catch (e) {
        throw new Error("No se pudo crear la base de datos MySQL para este servidor.");
    }
  }

  const blenderPass = generateSecurePassword();
  const instanceDir = path.join(config.instanceDataRoot, serverId);
  await fs.mkdir(instanceDir, { recursive: true });

  const tunnelUrl = isNonFivem
    ? `${config.fivemPublicHost}:${fPort}`
    : `https://${getRagenodesTunnelHostname(serverId, tPort, '', 'tx')}`;

  await query(
    `INSERT INTO servers (id, owner_id, name, slug, template, runtime_plan, status, fivem_port, txadmin_port, blender_port, blender_pass, db_name, db_user, db_pass, container_name, data_path, license_key_hint, txadmin_url, expires_at, mc_version, mc_type, allocated_ram_gb) VALUES ($1,$2,$3,$4,$5,$6,'running',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    [serverId, userId, payload.serverName, 'slug', template, assignedPlan, fPort, tPort, bPort, blenderPass, dbName, dbUser, dbPass, cName, instanceDir, 'hidden', tunnelUrl, expireDate, payload.mcVersion || 'LATEST', payload.mcType || 'PAPER', requestedRamGb]
  );
  await query('UPDATE servers SET node_id = $1 WHERE id = $2', [targetNodeId, serverId]);


  try {
    const containerOpts = {
      containerName: cName,
      dataPath: instanceDir,
      gamePort: fPort,
      fivemPort: fPort,
      txadminPort: tPort,
      serverId,
      serverName: payload.serverName,
      licenseKey: payload.licenseKey,
      plan: customPlan || plan,
      dbName,
      dbUser,
      dbPass,
      nodeId: targetNodeId,
      mcVersion: payload.mcVersion || 'LATEST',
      mcType: payload.mcType || 'PAPER',
      maxPlayers: payload.maxPlayers || 20
    };

    if (GameFactory.has(template)) {
      await GameFactory.create(template, containerOpts);
      if (template === 'fivem' && tPort) {
        updateTunnelConfig(serverId.slice(0, 8), tPort, 'add').catch(e => console.error(e));
      }
    } else {
      await Docker.createFivemContainer(containerOpts);
      updateTunnelConfig(serverId.slice(0, 8), tPort, 'add').catch(e => console.error(e));
    }
  } catch (dockerError) {
    console.error("❌ Error creando contenedor de Docker, haciendo ROLLBACK en BD:", dockerError.message);
    try {
      const failedDocker = await Docker.getNodeConnection(targetNodeId);
      await failedDocker.getContainer(cName).remove({ force: true });
    } catch (cleanupError) {
      if (cleanupError?.statusCode !== 404) {
        console.warn(`⚠️ No se pudo retirar el contenedor fallido ${cName}: ${cleanupError.message}`);
      }
    }
    try {
      await Docker.runRemoteCommand(targetNodeId, Docker.sh`rm -rf -- ${instanceDir}`);
    } catch (cleanupError) {
      console.warn(`⚠️ No se pudo retirar el directorio incompleto ${instanceDir}: ${cleanupError.message}`);
    }
    // 🛡️ Rollback de MySQL/MariaDB si se crearon credenciales
    if (dbName && dbUser) {
      try {
        const centralConn = await mysql.createConnection({
          host: 'mariadb',
          user: 'root',
          password: config.centralDbPass,
          port: 3306
        });
        const safeDb = dbName.replace(/[^a-zA-Z0-9_]/g, '');
        const safeUser = dbUser.replace(/[^a-zA-Z0-9_]/g, '');
        await centralConn.query(`DROP DATABASE IF EXISTS \`${safeDb}\``);
        await centralConn.query(`DROP USER IF EXISTS '${safeUser}'@'%'`);
        await centralConn.end();
      } catch (dbCleanupError) {
        console.warn(`⚠️ No se pudo eliminar la base de datos MariaDB ${dbName}: ${dbCleanupError.message}`);
      }
    }
    await query('DELETE FROM servers WHERE id = $1', [serverId]);
    throw new Error('No se pudo iniciar el servidor. La operación se revirtió de forma segura; inténtalo de nuevo o contacta con soporte.');
  }

  await logAudit(userId, 'SERVER.CREATE', { serverId, serverName: payload.serverName, plan: assignedPlan, template });
  return getServerByIdForUser(serverId, userId, true);
  } finally {
    userCreationLocks.delete(userId);
  }
}

export async function getServerDetails(id, userId, isAdmin) {
  const s = await getServerByIdForUser(id, userId, isAdmin);
  if (!s) return null;
  const canViewSecrets = isAdmin || s.owner_id === userId;

  // 🦖 Auto-crear base de datos para servidores ARK existentes si no la tienen
  if (canViewSecrets && s.template === 'ark' && !s.db_name) {
    const shortId = s.id.slice(0,8);
    const dbName = `ark_${shortId.replace(/-/g, '_')}`;
    const dbUser = `usr_${shortId}`;
    const dbPass = generateSecurePassword();
    try {
        const dbConnection = await mysql.createConnection({
            host: 'mariadb', user: 'root', password: config.centralDbPass
        });
        const escapedDbName = mysql.escapeId(dbName);
        await dbConnection.query(`CREATE DATABASE IF NOT EXISTS ${escapedDbName}`);
        await dbConnection.query(`CREATE USER IF NOT EXISTS ?@'%' IDENTIFIED BY ?`, [dbUser, dbPass]);
        await dbConnection.query(`GRANT ALL PRIVILEGES ON ${escapedDbName}.* TO ?@'%'`, [dbUser]);
        await dbConnection.query(`FLUSH PRIVILEGES`);
        await dbConnection.end();

        await query('UPDATE servers SET db_name = $1, db_user = $2, db_pass = $3 WHERE id = $4', [dbName, dbUser, dbPass, s.id]);
        s.db_name = dbName;
        s.db_user = dbUser;
        s.db_pass = dbPass;
    } catch (e) {
        console.error(`❌ Error auto-creando BD para ARK ${s.name}:`, e.message);
    }
  }

  const state = await Docker.resolveContainerState(s.container_name);
  s.status = !state.exists ? 'missing' : (state.running ? 'running' : 'stopped');
  const usedDiskBytes = await getFolderSize(s.data_path);
  const plan = PLANS[s.runtime_plan] || PLANS.hobby;
  const maxDisk = (plan.diskBytes || (20 * 1024 ** 3)) + ((s.extra_disk_gb || 0) * 1024 ** 3);
  const diskPercent = Math.min(((usedDiskBytes / maxDisk) * 100), 100);
  const diskGb = usedDiskBytes / (1024 ** 3);

  if (s.status === 'running') {
      s.stats = await Docker.getContainerStats(s.container_name);
      s.stats.disk = diskPercent;
      s.stats.diskGb = diskGb;
  } else {
      s.stats = { cpu: 0, ram: 0, ramGb: 0, disk: diskPercent, diskGb: diskGb };
  }

  const bState = await Docker.resolveContainerState(`ragenodes-blender-${s.id.slice(0,8)}`);
  s.blender_status = bState.running ? 'running' : 'stopped';
  if (!canViewSecrets) {
      delete s.db_name;
      delete s.db_user;
      delete s.db_pass;
      delete s.blender_pass;
      delete s.discord_webhook_url;
      delete s.data_path;
      delete s.container_name;
      delete s.license_key_hint;
      delete s.subuser_permissions;
  }
  return s;
}

export async function toggleBlenderForServer(id, userId, isAdmin, action) {
  const s = await getServerByIdForUser(id, userId, isAdmin, 'files');
  if (!s) throw new Error("No encontrado");
  if (s.runtime_plan === 'hobby') throw new Error("El plan Hobby no incluye Editor 3D.");

  if (action === 'start') {
      blenderActivity.set(id, Date.now());
  } else if (action === 'stop') {
      blenderActivity.delete(id);
  }

  return Docker.toggleBlender({
      serverId: s.id, dataPath: s.data_path, blenderPort: s.blender_port, blenderPass: s.blender_pass,
      plan: PLANS[s.runtime_plan] || PLANS.hobby
  }, action);
}

export async function renewBlenderHeartbeat(id, userId, isAdmin) {
    const s = await getServerByIdForUser(id, userId, isAdmin, 'files');
    if (!s) throw new Error("No encontrado");
    blenderActivity.set(id, Date.now());
    return { success: true, timestamp: Date.now() };
}

// 🛡️ TAREA DE LIMPIEZA AUTOMÁTICA (Cada 5 minutos)
setInterval(async () => {
    const now = Date.now();
    for (const [serverId, lastSeen] of blenderActivity.entries()) {
        if (now - lastSeen > BLENDER_INACTIVITY_MS) {
            try {
                const s = (await query('SELECT * FROM servers WHERE id = $1', [serverId])).rows[0];
                if (s) {
                    await Docker.toggleBlender({
                        serverId: s.id, dataPath: s.data_path, blenderPort: s.blender_port, blenderPass: s.blender_pass
                    }, 'stop');
                    blenderActivity.delete(serverId);
                }
            } catch (e) {
                console.error(`❌ Error auto-stop Blender:`, e.message);
                blenderActivity.delete(serverId);
            }
        }
    }
}, 5 * 60 * 1000);

export async function repairServer(id, userId, isAdmin) {
  const s = await getServerByIdForUser(id, userId, isAdmin);
  if (!s) throw new Error("No encontrado");

  if (!isAdmin && s.status === 'suspended') {
      throw new Error("El servidor está suspendido por falta de pago. No se puede reparar en este estado.");
  }

  const { rowCount } = await query("UPDATE servers SET status = 'recreating' WHERE id = $1 AND status != 'recreating'", [s.id]);
  if (rowCount === 0) {
      console.warn(`⏳ [Repair] Servidor ${s.name} ya está en proceso de recreación/mantenimiento. Omitiendo.`);
      return { success: false, reason: 'already_recreating' };
  }

  checkSystemLoad();
  await logAudit(userId, 'SERVER.REPAIR.START', { serverId: s.id });

  const cachePath = path.join(s.data_path, 'cache');
  try { await fs.rm(cachePath, { recursive: true, force: true }); } catch {}

  const plan = PLANS[s.runtime_plan] || PLANS.hobby;
  let realLicenseKey = 'hidden';
  try {
      const inspect = await Docker.inspectContainer(s.container_name);
      const env = inspect.Config.Env || [];
      const lkEnv = env.find(e => e.startsWith('LICENSE_KEY='));
      if (lkEnv) realLicenseKey = lkEnv.split('=')[1];
  } catch (e) {}

  const opts = {
      containerName: s.container_name, dataPath: s.data_path, fivemPort: s.fivem_port,
      txadminPort: s.txadmin_port, serverName: s.name, licenseKey: realLicenseKey, plan,
      gamePort: s.fivem_port, mcVersion: s.mc_version, mcType: s.mc_type,
      serverId: s.id, dbName: s.db_name, dbUser: s.db_user, dbPass: s.db_pass, nodeId: s.node_id,
      clusterId: s.cluster_id, cpuset: s.cpuset
  };

  try {
      switch (s.template) {
          case 'minecraft': await Docker.restartMinecraftContainer(opts); break;
          case 'rust': await Docker.restartRustContainer(opts); break;
          case 'palworld': await Docker.restartPalworldContainer(opts); break;
          case 'cs2': await Docker.restartCS2Container(opts); break;
          case 'valheim': await Docker.restartValheimContainer(opts); break;
          case 'zomboid': await Docker.restartZomboidContainer(opts); break;
          case 'ark': await Docker.restartARKContainer(opts); break;
          case 'sdtd': await Docker.restartSDTDContainer(s.container_name, s.id, s.fivem_port, plan, s.data_path); break;
          case 'discord': await Docker.restartDiscordBotContainer(opts); break;
          case 'wordpress': await Docker.restartWordPressContainer(opts); break;
          case 'database': await Docker.restartDatabaseContainer(opts); break;
          case 'fivem': await Docker.restartFivemContainer(opts); break;
          default: throw new Error(`Plantilla desconocida: ${s.template}`);
      }
      await query("UPDATE servers SET status = 'running' WHERE id = $1", [s.id]);

      // Ensure Cloudflare tunnel is restored if it was dropped
      if ((s.template === 'fivem' && s.txadmin_port) || s.template === 'wordpress') {
          import('./cloudflareService.js').then(({ updateServerTunnelConfig }) => {
              const port = s.template === 'fivem' ? s.txadmin_port : s.fivem_port;
              const prefix = s.template === 'fivem' ? 'tx' : 'wp';
              updateServerTunnelConfig(s.id, port, s.txadmin_url, 'add', 'host.docker.internal', prefix).catch(e => console.error(e));
          }).catch(e => {});
      }
      return { success: true };
  } catch (err) {
      await query("UPDATE servers SET status = 'error' WHERE id = $1", [s.id]);
      await logAudit(userId, 'SERVER.REPAIR.FAILED', { serverId: s.id, error: err.message });
      throw err;
  }
}

export async function getServerLogs(id, userId, isAdmin) {
  const s = await getServerByIdForUser(id, userId, isAdmin, 'console');
  if (!s) throw new Error('Servidor no encontrado o sin permiso de consola.');
  return { logs: await Docker.fetchContainerLogs(s.container_name) };
}

export async function getAllServers() {
  const { rows } = await query('SELECT * FROM servers');
  return rows;
}

export async function setServerBackupTime(id, userId, time, isAdmin) {
  const s = await getServerByIdForUser(id, userId, isAdmin, 'files');
  if (!s) throw new Error('Servidor no encontrado o sin permiso de archivos.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) throw new Error('Hora de backup inválida.');
  await query('UPDATE servers SET backup_time = $1 WHERE id = $2', [time, id]);
  return { success: true };
}

export async function getServerStatsHistory(id, userId, isAdmin) {
    const s = await getServerByIdForUser(id, userId, isAdmin);
    if (!s) throw new Error("Servidor no encontrado");
    const { rows } = await query('SELECT cpu, ram, ram_gb, created_at FROM server_stats_history WHERE server_id = $1 ORDER BY created_at DESC LIMIT 50', [s.id]);
    return rows.reverse();
}

export async function controlServer(id, userId, action, isAdmin) {
  const s = await getServerByIdForUser(id, userId, isAdmin);
  if (!s) throw new Error("No encontrado");

  if (!isAdmin && (action === 'start' || action === 'restart') && s.status === 'suspended') {
      throw new Error("El servidor está suspendido por falta de pago. Por favor, renueva tu suscripción.");
  }

  if (s.owner_id !== userId && !isAdmin) {
      const suRes = await query("SELECT permissions FROM server_subusers WHERE server_id = $1 AND user_id = $2", [s.id, userId]);
      if (suRes.rowCount === 0) throw new Error("Acceso denegado.");
      const perms = suRes.rows[0].permissions || [];
      if (!perms.includes('power') && !perms.includes('restart')) {
          throw new Error("No tienes permiso para controlar la energía de este servidor.");
      }
  }

  if (action === 'start') {
      checkSystemLoad();
      try {
          await Docker.startContainer(s.container_name);

          if (s.template === 'fivem') {
              setTimeout(() => {
                  Docker.runRemoteCommand(s.node_id, `docker exec -u 0 ${s.container_name} sh -c "cat /opt/fivem/alpine/opt/cfx-server/citizen/system_resources/monitor/core/index.js | sed 's/sameSite:\\"lax\\"/sameSite:\\"none\\",secure:true/g' > /tmp/index.js && cp /tmp/index.js /opt/fivem/alpine/opt/cfx-server/citizen/system_resources/monitor/core/index.js" || true`);
                  Docker.runRemoteCommand(s.node_id, `docker exec -u 0 ${s.container_name} sh -c "cat /opt/fivem/alpine/opt/cfx-server/citizen/system_resources/monitor/panel/index-*.js | sed 's/SameSite=Lax/SameSite=None;Secure/g' > /tmp/panel.js && cp /tmp/panel.js /opt/fivem/alpine/opt/cfx-server/citizen/system_resources/monitor/panel/\\$(ls /opt/fivem/alpine/opt/cfx-server/citizen/system_resources/monitor/panel | grep index-.*\\\\.js | head -n 1)" || true`);
                  setTimeout(() => { Docker.runRemoteCommand(s.node_id, `docker restart ${s.container_name}`); }, 2000);
              }, 5000);
          }
          await query("UPDATE servers SET status = 'running' WHERE id = $1", [s.id]);
      } catch (err) {
          if (err.message.includes('No such container') || err.message.includes('404')) {
              console.log(`[Auto-Fix] Contenedor ${s.container_name} no encontrado al iniciar. Forzando recreación.`);
              action = 'restart'; // Pasa al bloque de restart de abajo
          } else {
              throw err;
          }
      }
  }
  if (action === 'stop') {
      await query("UPDATE servers SET status = 'stopping' WHERE id = $1", [s.id]);
      try {
          await Docker.stopContainer(s.container_name);
      } catch (e) {
          console.error(`[ServerService] Error al detener contenedor ${s.container_name}: ${e.message}`);
      }
      await query("UPDATE servers SET status = 'stopped' WHERE id = $1", [s.id]);
  }
  if (action === 'restart') {
      const { rowCount } = await query("UPDATE servers SET status = 'recreating' WHERE id = $1 AND status != 'recreating'", [s.id]);
      if (rowCount === 0) {
          throw new Error("El servidor ya está en proceso de reinicio o recreación. Por favor, espera unos segundos.");
      }

      checkSystemLoad();
      const basePlan = PLANS[s.runtime_plan] || PLANS.hobby;
      const plan = s.allocated_ram_gb > 0 ? { ...basePlan, memoryBytes: s.allocated_ram_gb * 1024 * 1024 * 1024 } : basePlan;
      let realLicenseKey = 'hidden';
      try {
          const inspect = await Docker.inspectContainer(s.container_name);
          const env = inspect.Config.Env || [];
          const lkEnv = env.find(e => e.startsWith('LICENSE_KEY='));
          if (lkEnv) realLicenseKey = lkEnv.split('=')[1];
      } catch (e) {}

      const opts = {
          containerName: s.container_name, dataPath: s.data_path,
          fivemPort: s.fivem_port, txadminPort: s.txadmin_port,
          serverId: s.id, serverName: s.name, licenseKey: realLicenseKey, plan, dbName: s.db_name, dbUser: s.db_user, dbPass: s.db_pass, nodeId: s.node_id,
          gamePort: s.fivem_port, mcVersion: s.mc_version, mcType: s.mc_type,
          clusterId: s.cluster_id, cpuset: s.cpuset
      };

      try {
          switch (s.template) {
              case 'minecraft': await Docker.restartMinecraftContainer(opts); break;
              case 'rust': await Docker.restartRustContainer(opts); break;
              case 'palworld': await Docker.restartPalworldContainer(opts); break;
              case 'cs2': await Docker.restartCS2Container(opts); break;
              case 'valheim': await Docker.restartValheimContainer(opts); break;
              case 'zomboid': await Docker.restartZomboidContainer(opts); break;
              case 'ark': await Docker.restartARKContainer(opts); break;
              case 'sdtd': await Docker.restartSDTDContainer(s.container_name, s.id, s.fivem_port, plan, s.data_path); break;
              case 'discord': await Docker.restartDiscordBotContainer(opts); break;
              case 'wordpress': await Docker.restartWordPressContainer(opts); break;
              case 'database': await Docker.restartDatabaseContainer(opts); break;
              default: await Docker.restartFivemContainer(opts); break;
          }

          if ((s.template === 'fivem' && s.txadmin_port) || s.template === 'wordpress') {
              import('./cloudflareService.js').then(({ updateServerTunnelConfig }) => {
                  const port = s.template === 'fivem' ? s.txadmin_port : s.fivem_port;
                  const prefix = s.template === 'fivem' ? 'tx' : 'wp';
                  updateServerTunnelConfig(s.id, port, s.txadmin_url, 'add', 'host.docker.internal', prefix).catch(e => console.error(e));
              }).catch(e => {});
          }
      } finally {
          await query("UPDATE servers SET status = 'running' WHERE id = $1", [s.id]);
      }
  }

  await logAudit(userId, `SERVER.${action.toUpperCase()}`, { serverId: s.id, serverName: s.name });
  return getServerDetails(id, userId, isAdmin);
}

export async function deleteServer(id, userId, isAdmin) {
  const s = await getServerByIdForUser(id, userId, isAdmin);
  if (!s) throw new Error("No encontrado");
  if (!isAdmin && s.owner_id !== userId) throw new Error('Solo el propietario puede eliminar el servidor.');

  await query("UPDATE servers SET status = 'deleting' WHERE id = $1", [s.id]);

  await Docker.removeContainer(s.container_name);
  await Docker.removeContainer(`ragenodes-blender-${s.id.slice(0,8)}`);
  try { updateTunnelConfig(s.id.slice(0, 8), null, 'remove').catch(e => console.error(`Cloudflare remove error: ${e.message}`)); } catch (e) {}
  await query('DELETE FROM servers WHERE id = $1', [s.id]);
  try { await fs.rm(s.data_path, { recursive: true, force: true }); } catch {}

  return { success: true };
}

// 🛡️ MANTENIMIENTO PROACTIVO (Cada 60 segundos)
setInterval(async () => {
    try {
        console.log("🛠️ [Mantenimiento] Iniciando escaneo de salud de servidores...");

        // 🛡️ Auto-curado de infraestructura crítica
        const coreContainers = ['oxide_web', 'tunnel', 'wg-easy', 'oxide_control_panel'];
        for (const core of coreContainers) {
            try {
                const coreState = await Docker.resolveContainerState(core);
                if (coreState.exists && !coreState.running) {
                    console.log(`⚠️ [Mantenimiento] Servicio core ${core} detectado offline. Intentando reiniciar...`);
                    await Docker.startContainer(core);
                }
            } catch (e) {}
        }

        // Limpieza automática de sub-usuarios huérfanos (Auto-Curado de Base de Datos)
        await query(`
            DELETE FROM users
            WHERE id NOT IN (SELECT owner_id FROM servers)
            AND id NOT IN (SELECT user_id FROM server_subusers)
            AND role != 'admin'
            AND username ~ '_[0-9a-f]{4}$'
        `);

        // Filtramos en Postgres para evitar procesamiento inútil en contenedores apagados o suspendidos
        const { rows: servers } = await query("SELECT id, name, status, template, fivem_port, txadmin_port, txadmin_url, container_name, data_path, runtime_plan, allocated_ram_gb, cluster_id FROM servers WHERE status NOT IN ('stopped', 'stopping', 'suspended', 'deleting')");

        // Ejecución en lotes para no asfixiar al host ni al API de Docker
        const CHUNK_SIZE = MAINTENANCE_CHUNK_SIZE;
        for (let i = 0; i < servers.length; i += CHUNK_SIZE) {
            const chunk = servers.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async (s) => {
                try {
                    let needsFix = false;
                    const state = await Docker.resolveContainerState(s.container_name);

                    if (state.exists) {
                        const inspect = state.inspect || await Docker.inspectContainer(s.container_name);
                        const portBindings = inspect.HostConfig.PortBindings || {};

                        // 🛡️ Si el contenedor existe pero está apagado (Exited/Dead), se debe reparar de inmediato
                        if (!state.running) {
                            // Secondary DB check to prevent race condition if user stopped it while maintenance loop was iterating
                            const { rows: freshCheck } = await query("SELECT status FROM servers WHERE id = $1", [s.id]);
                            if (freshCheck.length > 0 && !['stopped', 'stopping', 'suspended', 'deleting'].includes(freshCheck[0].status)) {
                                console.log(`⚠️ [Mantenimiento] Contenedor ${s.name} está offline (no running). Forzando auto-curado.`);
                                needsFix = true;
                            } else {
                                console.log(`ℹ️ [Mantenimiento] Contenedor ${s.name} está offline pero su estado en DB es ${freshCheck[0]?.status}. Ignorando.`);
                            }
                        }

                        // 🛡️ Solo marcar como privado si TIENE bindings y todos son 127.0.0.1
                        const bindingsKeys = Object.keys(portBindings);
                        const isPrivate = bindingsKeys.length > 0 && Object.values(portBindings).every(bindings =>
                            bindings && bindings.every(b => b.HostIp === '127.0.0.1')
                        );

                        if (!needsFix && isPrivate) {
                            console.log(`⚠️ [Mantenimiento] Corrigiendo red de ${s.name} a Modo Directo.`);
                            needsFix = true;
                        }

                        if (!needsFix) {
                            const uptimeStr = inspect.State.StartedAt;
                            const uptimeMs = Date.now() - new Date(uptimeStr).getTime();

                            // 🛡️ Verificar Logs para errores fatales
                            const logs = await Docker.fetchContainerLogs(s.container_name);
                            const tailLogs = logs.slice(-5000).toLowerCase();
                            if (tailLogs.includes('address already in use') || tailLogs.includes('segmentation fault') || tailLogs.includes('core dumped')) {
                                console.log(`⚠️ [Mantenimiento] Error fatal detectado en los logs de ${s.name}. Forzando reinicio.`);
                                needsFix = true;
                            }

                            // 🛡️ Verificar TCP Port Ping si lleva más de 5 min arrancado
                            if (!needsFix && uptimeMs > 5 * 60 * 1000) {
                                let checkPort = s.fivem_port;
                                if (s.template === 'rust' || s.template === 'palworld') checkPort = s.fivem_port + 1; // RCON
                                if (s.template === 'ark') checkPort = s.fivem_port + 13; // RCON

                                if (s.template !== 'valheim' && s.template !== 'zomboid' && s.template !== 'ark') {
                                    const isPortReachable = await verifyServerPort('172.17.0.1', checkPort, 'tcp');
                                    if (!isPortReachable) {
                                        console.log(`⚠️ [Mantenimiento] Puerto TCP ${checkPort} no responde para ${s.name} (Uptime: ${Math.round(uptimeMs/60000)}m). Posible cuelgue.`);
                                        needsFix = true;
                                    }
                                }
                            }

                            // 🛡️ CONTROL DE CUOTA DE DISCO EN 3 PASOS
                            const usedDiskBytes = getFolderSizeSnapshot(s.data_path);
                            const plan = PLANS[s.runtime_plan] || PLANS.hobby;
                            const maxDisk = (plan.diskBytes || (20 * 1024 ** 3)) + ((s.extra_disk_gb || 0) * 1024 ** 3);
                            const diskPercent = (usedDiskBytes / maxDisk) * 100;

                            const lastWarn = global.lastQuotaWarning || new Map();
                            global.lastQuotaWarning = lastWarn;

                            if (diskPercent >= 100 && !needsFix) {
                                console.log(`🛑 [Cuota de Disco] Servidor ${s.name} alcanzó el 100% de uso. Apagando por seguridad.`);
                                await Docker.stopContainer(s.container_name);
                                await query("UPDATE servers SET status = 'stopped' WHERE id = $1", [s.id]);
                                await query("INSERT INTO notifications (title, content, type) VALUES ($1, $2, $3)", [
                                    `Servidor Apagado: ${s.name}`,
                                    `El servidor superó su límite de almacenamiento (${(maxDisk / (1024**3)).toFixed(2)} GB). Fue apagado por seguridad.`,
                                    'error'
                                ]);
                                needsFix = false; // Ya lo detuvimos
                            } else if (diskPercent >= 95 && !needsFix) {
                                const last = lastWarn.get(`${s.id}_95`) || 0;
                                if (Date.now() - last > 6 * 60 * 60 * 1000) { // 6 hours
                                    console.log(`⚠️ [Cuota de Disco] Servidor ${s.name} superó el 95% de uso.`);
                                    await query("INSERT INTO notifications (title, content, type) VALUES ($1, $2, $3)", [
                                        `Alerta Crítica de Espacio: ${s.name}`,
                                        `El servidor superó el 95% de almacenamiento (${diskPercent.toFixed(1)}%). Si llega al 100% se apagará automáticamente.`,
                                        'warning'
                                    ]);
                                    lastWarn.set(`${s.id}_95`, Date.now());
                                }
                            } else if (diskPercent >= 85 && !needsFix) {
                                const last = lastWarn.get(`${s.id}_85`) || 0;
                                if (Date.now() - last > 24 * 60 * 60 * 1000) { // 24 hours
                                    await query("INSERT INTO notifications (title, content, type) VALUES ($1, $2, $3)", [
                                        `Aviso de Espacio: ${s.name}`,
                                        `El servidor superó el 85% de almacenamiento (${diskPercent.toFixed(1)}%). Considera limpiar archivos innecesarios.`,
                                        'info'
                                    ]);
                                    lastWarn.set(`${s.id}_85`, Date.now());
                                }
                            }
                        }
                    } else {
                        needsFix = true;
                    }

                    if (needsFix) {
                        if (shouldRepairWithBackoff(s.id)) {
                            await repairOneServer(s);
                            console.log(`✅ [Mantenimiento] ${s.name} restaurado con éxito.`);
                        } else {
                            console.log(`❌ [Mantenimiento] ${s.name} ha fallado demasiadas veces. Pausando auto-curado.`);
                            await query("UPDATE servers SET status = 'error' WHERE id = $1", [s.id]);
                        }
                    }

                    // 🚀 AUTOMATIZACIÓN CLOUDFLARE (Solo para FiveM)
                    if (s.template === 'fivem' && s.txadmin_port) {
                        const tunnelUrl = `https://${getRagenodesTunnelHostname(s.id, s.txadmin_port, '', 'tx')}`;
                        const activeTunnelUrl = s.txadmin_url || tunnelUrl;
                        if (/^https:\/\/(?:[a-z0-9-_]+\.)?ragenodes\.com\/?$/i.test(activeTunnelUrl)) {
                            // Sync is handled by createServer and deleteServer, no need to blindly sync every 60s
                        }
                        if (s.txadmin_url !== tunnelUrl) {
                            await query('UPDATE servers SET txadmin_url = $1 WHERE id = $2', [tunnelUrl, s.id]);
                        }
                    }
                } catch (e) {
                    console.error(`❌ Error en mantenimiento de ${s.name}:`, e.message);
                }
            }));

            // Ligera pausa entre lotes si quedan más por procesar
            if (i + CHUNK_SIZE < servers.length) {
                await new Promise(r => setTimeout(r, 500));
            }
        }

        console.log("☁️ [Mantenimiento] Iniciando limpieza de túneles huérfanos en Cloudflare...");
        await cleanOrphanedTunnels();
    } catch (e) {
        console.error("❌ Mantenimiento Error:", e.message);
    }
}, MAINTENANCE_INTERVAL_MS);

// Helper para reparar un servidor individualmente
export async function repairOneServer(s) {
    const { rowCount } = await query("UPDATE servers SET status = 'recreating' WHERE id = $1 AND status != 'recreating'", [s.id]);
    if (rowCount === 0 && s.status !== 'error') {
        // Allow retry if it was already in recreating, but to prevent infinite loops without delay we set it to error if it fails
        console.warn(`⏳ [Mantenimiento] Servidor ${s.name} ya está en proceso de recreación. Omitiendo por ahora.`);
        return;
    }

    const basePlan = PLANS[s.runtime_plan] || PLANS.hobby;
    const plan = s.allocated_ram_gb > 0 ? { ...basePlan, memoryBytes: s.allocated_ram_gb * 1024 * 1024 * 1024 } : basePlan;
    const opts = {
        containerName: s.container_name, dataPath: s.data_path, fivemPort: s.fivem_port,
        txadminPort: s.txadmin_port, serverName: s.name, licenseKey: 'hidden', plan,
        gamePort: s.fivem_port, mcVersion: s.mc_version, mcType: s.mc_type,
        serverId: s.id, dbName: s.db_name, dbUser: s.db_user, dbPass: s.db_pass, nodeId: s.node_id,
        clusterId: s.cluster_id
    };

    console.log(`🔧 [Mantenimiento] Reparando ${s.name} (Template: ${s.template})...`);

    try {
        switch (s.template) {
            case 'minecraft': await Docker.restartMinecraftContainer(opts); break;
            case 'rust': await Docker.restartRustContainer(opts); break;
            case 'palworld': await Docker.restartPalworldContainer(opts); break;
            case 'cs2': await Docker.restartCS2Container(opts); break;
            case 'valheim': await Docker.restartValheimContainer(opts); break;
            case 'zomboid': await Docker.restartZomboidContainer(opts); break;
            case 'ark': await Docker.restartARKContainer(opts); break;
            case 'sdtd': await Docker.restartSDTDContainer(s.container_name, s.id, s.fivem_port, plan, s.data_path); break;
            case 'discord': await Docker.restartDiscordBotContainer(opts); break;
            case 'wordpress': await Docker.restartWordPressContainer(opts); break;
            case 'database': await Docker.restartDatabaseContainer(opts); break;
            case 'fivem':
                let realLicenseKey = 'hidden';
                try {
                    const inspect = await Docker.inspectContainer(s.container_name);
                    const env = inspect.Config.Env || [];
                    const lkEnv = env.find(e => e.startsWith('LICENSE_KEY='));
                    if (lkEnv) realLicenseKey = lkEnv.split('=')[1];
                } catch (e) {}
                opts.licenseKey = realLicenseKey;
                await Docker.restartFivemContainer(opts);
                break;
            default:
                console.warn(`[Auto-Curado] Plantilla desconocida '${s.template}' para ${s.name}. Omitiendo reparación específica.`);
                break;
        }
        const { rows } = await query("SELECT status FROM servers WHERE id = $1", [s.id]);
        if (rows.length > 0 && (rows[0].status === 'stopped' || rows[0].status === 'stopping')) {
            console.warn(`[Auto-Curado] Reparación de ${s.name} cancelada: El usuario solicitó detener el servidor durante la reparación.`);
            await Docker.stopContainer(s.container_name);
            return;
        }

        await query("UPDATE servers SET status = 'running' WHERE id = $1", [s.id]);

        if ((s.template === 'fivem' && s.txadmin_port) || s.template === 'wordpress') {
            import('./cloudflareService.js').then(({ updateServerTunnelConfig }) => {
                const port = s.template === 'fivem' ? s.txadmin_port : s.fivem_port;
                const prefix = s.template === 'fivem' ? 'tx' : 'wp';
                updateServerTunnelConfig(s.id, port, s.txadmin_url, 'add', 'host.docker.internal', prefix).catch(e => console.error(e));
            }).catch(e => {});
        }
    } catch (e) {
        console.error(`❌ Error en mantenimiento de ${s.name}:`, e.message);
        await query("UPDATE servers SET status = 'error' WHERE id = $1", [s.id]);
    }
}

// ==========================================
// 🚀 GESTIÓN DE SUB-USUARIOS (EQUIPO)
// ==========================================

export async function getSubusersForServer(serverId, userId, isAdmin = false) {
    const s = await getServerByIdForUser(serverId, userId, isAdmin);
    if (!s) throw new Error("Servidor no encontrado");
    if (!isAdmin && s.owner_id !== userId) throw new Error('Solo el propietario puede consultar el equipo.');

    const res = await query(`
        SELECT su.id as subuser_id, u.id as user_id, u.username, u.email, su.permissions, su.created_at
        FROM server_subusers su
        JOIN users u ON su.user_id = u.id
        WHERE su.server_id = $1
    `, [serverId]);
    return res.rows;
}

export async function addSubuserToServer(serverId, userId, isAdmin, usernameOrEmail, permissions = ['restart', 'console']) {
    const s = await getServerByIdForUser(serverId, userId, isAdmin);
    if (!s) throw new Error("Servidor no encontrado");
    if (s.owner_id !== userId && !isAdmin) throw new Error("Solo el propietario puede gestionar el equipo.");

    let targetUserId;
    let isNewUser = false;
    const targetRes = await query("SELECT id FROM users WHERE username = $1 OR email = $1", [usernameOrEmail]);

    if (targetRes.rowCount === 0) {
        if (!usernameOrEmail.includes('@')) {
            throw new Error("Usuario no encontrado. Para invitar a un nuevo colaborador sin cuenta, introduce su correo electrónico.");
        }

        isNewUser = true;
        const tempPassword = generateSecurePassword();
        const baseUsername = usernameOrEmail.split('@')[0].replace(/[^a-zA-Z0-9]/g, '');
        const username = baseUsername + '_' + crypto.randomBytes(2).toString('hex');
        const hash = await bcrypt.hash(tempPassword, 12);

        const insertRes = await query(
            'INSERT INTO users (username, email, password_hash, plan, is_verified) VALUES ($1, $2, $3, $4, true) RETURNING id',
            [username, usernameOrEmail, hash, 'hobby']
        );
        targetUserId = insertRes.rows[0].id;

        const ownerRes = await query("SELECT username FROM users WHERE id = $1", [s.owner_id]);
        const ownerUsername = ownerRes.rows[0]?.username || 'Propietario';

        await sendTeamInviteEmail(usernameOrEmail, username, tempPassword, s.name, ownerUsername);
    } else {
        targetUserId = targetRes.rows[0].id;
    }

    if (targetUserId === s.owner_id) throw new Error("El propietario ya tiene acceso total al servidor.");

    await query(`
        INSERT INTO server_subusers (server_id, user_id, permissions)
        VALUES ($1, $2, $3)
        ON CONFLICT (server_id, user_id) DO UPDATE SET permissions = EXCLUDED.permissions
    `, [serverId, targetUserId, JSON.stringify(permissions)]);

    return {
        success: true,
        message: isNewUser ? "Cuenta de equipo creada automáticamente y miembro añadido con éxito." : "Sub-usuario añadido o actualizado correctamente."
    };
}

export async function removeSubuserFromServer(serverId, userId, isAdmin, subuserId) {
    const s = await getServerByIdForUser(serverId, userId, isAdmin);
    if (!s) throw new Error("Servidor no encontrado");
    if (s.owner_id !== userId && !isAdmin) throw new Error("Solo el propietario puede gestionar el equipo.");

    await query("DELETE FROM server_subusers WHERE server_id = $1 AND id = $2", [serverId, subuserId]);
    return { success: true, message: "Sub-usuario eliminado correctamente." };
}

// ==========================================
// 🚀 GESTIÓN DE WEBHOOKS DE DISCORD
// ==========================================

export async function updateServerWebhook(serverId, userId, isAdmin, webhookUrl, events) {
    const s = await getServerByIdForUser(serverId, userId, isAdmin);
    if (!s) throw new Error("Servidor no encontrado");
    if (!isAdmin && s.owner_id !== userId) throw new Error('Solo el propietario puede configurar webhooks.');

    await query("UPDATE servers SET discord_webhook_url = $1, discord_webhook_events = $2 WHERE id = $3",
        [webhookUrl || null, JSON.stringify(events || ['online', 'offline', 'player_join', 'player_leave', 'update']), serverId]);
    return { success: true };
}

// ==========================================
// 🚀 GESTIÓN DE CLÚSTERES (CROSS-ARK)
// ==========================================

export async function updateServerCluster(serverId, userId, isAdmin, clusterId) {
    const s = await getServerByIdForUser(serverId, userId, isAdmin);
    if (!s) throw new Error("Servidor no encontrado");
    if (!isAdmin && s.owner_id !== userId) throw new Error('Solo el propietario puede configurar el clúster.');

    await query("UPDATE servers SET cluster_id = $1 WHERE id = $2", [clusterId || null, serverId]);
    return { success: true };
}

// ==========================================
// 🚀 GESTIÓN DE REINICIOS AUTOMÁTICOS
// ==========================================

export async function updateServerAutoRestart(serverId, userId, isAdmin, time, enabled, backupBeforeRestart) {
    const s = await getServerByIdForUser(serverId, userId, isAdmin, 'files');
    if (!s) throw new Error("Servidor no encontrado");

    await query("UPDATE servers SET auto_restart_time = $1, auto_restart_enabled = $2, backup_before_restart = $3 WHERE id = $4",
        [time || '06:00', !!enabled, !!backupBeforeRestart, serverId]);
    return { success: true };
}

// Removed setupDockerEventListener. Auto-Curado is now handled purely by dockerEventsService.js (RustEvents).

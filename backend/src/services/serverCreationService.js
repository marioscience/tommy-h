import fsPromises from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, logAudit } from '../db.js';
import { config, PLAN_LIMITS, generateSecurePassword } from '../config.js';
import * as Docker from './dockerService.js';
import { updateServerTunnelConfig } from './cloudflareService.js';
import { GameFactory } from './games/GameFactory.js';
import { getNextAvailablePort, selectDeploymentNode } from './serverNodeSelection.js';

const PLANS = PLAN_LIMITS;
const userCreationLocks = new Map();

function checkSystemLoad() {
    // Helper de carga del sistema
}

export async function createServerForUser(userId, payload) {
  if (userCreationLocks.get(userId)) {
      throw new Error("Ya tienes una creacion de servidor en progreso. Por favor, espera a que termine.");
  }
  userCreationLocks.set(userId, true);

  try {
    const userResult = await query('SELECT plan, server_limit, extra_disk_gb, expires_at FROM users WHERE id = $1', [userId]);
    let assignedPlan = 'hobby';
    let serverLimit = config.serverLimitPerUser;
    let extraDiskGb = 0;
    let expireDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    if (userResult.rows.length > 0) {
      assignedPlan = userResult.rows[0].plan || 'hobby';
      serverLimit = userResult.rows[0].server_limit ?? config.serverLimitPerUser;
      extraDiskGb = userResult.rows[0].extra_disk_gb || 0;
      if (userResult.rows[0].expires_at) {
          expireDate = new Date(userResult.rows[0].expires_at);
      }
    }

    const planConfig = PLANS[assignedPlan] || PLANS.hobby;

    const countResult = await query('SELECT COUNT(*) FROM servers WHERE owner_id = $1', [userId]);
    const currentCount = parseInt(countResult.rows[0].count, 10);
    if (currentCount >= serverLimit) {
      throw new Error(`Limite alcanzado: tu plan solo permite ${serverLimit} servidor(es).`);
    }

    const { name, template = 'fivem', licenseKeyHint = 'SIN_LICENCIA', explicitNodeId = null, cpuset = null } = payload;
    const requestedMcVersion = payload.mc_version || 'LATEST';
    const requestedMcType = payload.mc_type || 'PAPER';

    if (!name || name.trim().length === 0) throw new Error('El nombre del servidor es obligatorio.');

    const targetNode = await selectDeploymentNode(assignedPlan, planConfig.ramGb, template, explicitNodeId);
    const targetNodeId = Number(targetNode.id);
    const isMasterNode = (targetNodeId === 0);

    const safeName = name.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
    const serverId = uuidv4();
    const shortId = serverId.slice(0, 8);
    const slug = `${safeName.toLowerCase().replace(/\s+/g, '-')}-${shortId}`;

    const rangeRequired = (template === 'fivem') ? 2 : 1;
    const ports = await getNextAvailablePort(config.fivemBasePort, rangeRequired, targetNodeId);

    const fivemPort = ports;
    const txadminPort = (template === 'fivem') ? (ports + 1) : ports;
    const blenderPort = (template === 'fivem') ? (ports + 100) : null;

    const containerName = `ragenodes-${shortId}`;

    let dataPath;
    if (isMasterNode) {
        dataPath = path.join(config.instanceDataRoot, `fivem_${shortId}.base`);
        await fsPromises.mkdir(dataPath, { recursive: true });
    } else {
        dataPath = `/var/lib/ragenodes/data/fivem_${shortId}.base`;
    }

    const txAdminUrl = `http://${targetNode.ip_address || 'localhost'}:${txadminPort}`;
    const blenderPass = generateSecurePassword();

    let dbName = null, dbUser = null, dbPass = null;
    const gameSvc = GameFactory.getGameService(template);

    if (gameSvc.needsDatabase()) {
        dbName = `fivem_${shortId}`;
        dbUser = `u_${shortId}`;
        dbPass = generateSecurePassword();

        try {
            const mariaConn = await mysql.createConnection({
                host: process.env.MARIADB_HOST || 'mariadb',
                user: 'root',
                password: process.env.MARIADB_ROOT_PASSWORD || 'rootpass'
            });
            await mariaConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
            await mariaConn.query(`CREATE USER IF NOT EXISTS '${dbUser}'@'%' IDENTIFIED BY '${dbPass}';`);
            await mariaConn.query(`GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${dbUser}'@'%';`);
            await mariaConn.query('FLUSH PRIVILEGES;');
            await mariaConn.end();
        } catch (dbErr) {
            console.warn('[DB Setup Warning]', dbErr.message);
        }
    }

    await query(
      `INSERT INTO servers (
        id, owner_id, name, slug, template, runtime_plan, cpuset, status,
        fivem_port, txadmin_port, blender_port, blender_pass,
        container_name, data_path, license_key_hint, txadmin_url,
        db_name, db_user, db_pass, node_id, expires_at, mc_version, mc_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'creating', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
      [
        serverId, userId, safeName, slug, template, assignedPlan, cpuset,
        fivemPort, txadminPort, blenderPort, blenderPass,
        containerName, dataPath, licenseKeyHint, txAdminUrl,
        dbName, dbUser, dbPass, targetNodeId, expireDate, requestedMcVersion, requestedMcType
      ]
    );

    const createdServer = (await query('SELECT * FROM servers WHERE id = $1', [serverId])).rows[0];

    try {
        if (isMasterNode) {
            await gameSvc.deploy(createdServer, payload);
        }
    } catch (deployErr) {
        console.error('[Deploy Error]', deployErr);
        await query("UPDATE servers SET status = 'error' WHERE id = $1", [serverId]);
        throw deployErr;
    }

    await query("UPDATE servers SET status = 'stopped' WHERE id = $1", [serverId]);
    await logAudit(userId, 'server.create', { serverId, name: safeName, template, targetNodeId });

    return (await query('SELECT * FROM servers WHERE id = $1', [serverId])).rows[0];

  } finally {
      userCreationLocks.delete(userId);
  }
}

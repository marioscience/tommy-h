import Docker from 'dockerode';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { rustUtil } from '../utils/rustUtil.js';
import { redisClient } from '../db.js';
import { saveSDTDConfig } from './sdtdService.js';
import { exec } from 'child_process';
import util from 'util';

export * from './dockerUtils.js';
export * from './games/minecraft.js';
export * from './games/rust.js';
export * from './games/palworld.js';
export * from './games/cs2.js';
export * from './games/valheim.js';
export * from './games/zomboid.js';
export * from './games/ark.js';
export * from './games/fivem.js';
export * from './games/sdtd.js';

import { getDockerForContainer, applyRageNodesBranding, recreateContainer, getNodeConnection } from './dockerUtils.js';
import { createMinecraftContainer } from './games/minecraft.js';
import { createRustContainer } from './games/rust.js';
import { createPalworldContainer } from './games/palworld.js';
import { createCS2Container } from './games/cs2.js';
import { createValheimContainer } from './games/valheim.js';
import { createProjectZomboidContainer } from './games/zomboid.js';
import { createARKContainer } from './games/ark.js';
import { createFivemContainer } from './games/fivem.js';
import { createSDTDContainer } from './games/sdtd.js';
import { createDiscordBotContainer } from './games/discordbot.js';
import { createWordPressContainer } from './games/wordpress.js';
import { createDatabaseContainer } from './games/database.js';

const execAsync = util.promisify(exec);

export function promiseWithTimeout(promise, ms, timeoutErrorMsg = 'Operation timed out') {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutErrorMsg)), ms))
    ]);
}

const STATS_CACHE = new Map();
const CONTAINER_INSPECT_CACHE = new Map();
const CONTAINER_STATE_CACHE_MS = Math.max(0, Number(process.env.CONTAINER_STATE_CACHE_MS || 4000));

// 🛡️ PERFIL DE SEGURIDAD BLINDADO (Hardened)
// Drop ALL by default and only add minimum necessary for game servers

/**
 * 🚀 CACHÉ MAESTRA LOCAL POR HARD LINKS (Game Template Cloning)
 * Clona de forma instantánea los archivos base de un juego desde su plantilla maestra (si existe).
 */




/**
 * 📡 GESTOR DE CONEXIONES DISTRIBUIDAS
 * Obtiene o crea una conexión con el daemon de Docker de un nodo específico.
 */





async function startStatsCollector() {
    console.log("📊 [StatsCollector] Iniciando recolector de telemetría multi-nodo...");
    while (true) {
        try {
            const { query } = await import('../db.js');
            const nodesRes = await query("SELECT id FROM nodes WHERE status = 'active'");

            for (const nodeRow of nodesRes.rows) {
                try {
                    const docker = await getNodeConnection(nodeRow.id);
                    const containers = await docker.listContainers();
                    const ragenodeContainers = containers.filter(c =>
                        c.Names[0].startsWith('/' + config.containerPrefix) &&
                        !c.Names[0].startsWith('/ragenodes-blender-')
                    );

                    for (let i = 0; i < ragenodeContainers.length; i += 15) {
                        const batch = ragenodeContainers.slice(i, i + 15);
                        await Promise.all(batch.map(async (cInfo) => {
                            try {
                                const container = docker.getContainer(cInfo.Id);
                                const stats = await container.stats({ stream: false });
                                const result = await rustUtil.calculateStats(stats);

                                if (result) {
                                    const key = cInfo.Names[0].replace('/', '');
                                    const payload = {
                                        cpu: result.cpu,
                                        ram: result.ram,
                                        ramGb: result.ram_gb,
                                        net_rx: result.net_rx,
                                        net_tx: result.net_tx,
                                        disk: "0.0",
                                        diskGb: "0.0",
                                        updatedAt: Date.now(),
                                        nodeId: nodeRow.id
                                    };
                                    STATS_CACHE.set(key, payload);
                                    if (redisClient?.isOpen) {
                                        redisClient.setEx('ragenodes:stats:' + key, 60, JSON.stringify(payload)).catch(() => {});
                                    }
                                }
                            } catch (e) {}
                        }));
                    }
                } catch (nodeErr) {
                    console.error(`⚠️ [Stats] Error en nodo ${nodeRow.id}:`, nodeErr.message);
                }
            }
        } catch (e) {
            console.error("❌ Error en StatsCollector:", e);
        }
        await new Promise(r => setTimeout(r, 30000));
    }
}

async function startNodeMonitor() {
    console.log("🖥️ [NodeMonitor] Iniciando monitoreo de nodos...");
    setInterval(async () => {
        try {
            const { query } = await import('../db.js');
            const nodes = await query("SELECT * FROM nodes WHERE status = 'active'");
            for (const node of nodes.rows) {
                try {
                    const docker = await getNodeConnection(node.id);
                    const info = await docker.info();
                    await query("UPDATE nodes SET ram_total_gb = $1, cpu_cores = $2 WHERE id = $3",
                        [Math.round(info.MemTotal / 1024**3), info.NCPU, node.id]);
                } catch (e) {}
            }
        } catch (e) {}
    }, 60000);
}

const dockerTelemetryOwner = (process.env.NODE_ENV !== 'test') && (!process.env.RAGENODES_ROLE || process.env.RAGENODES_ROLE === 'worker-stats');
if (dockerTelemetryOwner) {
    startStatsCollector();
    startNodeMonitor();
}

export async function patchExistingContainers() {
    try {
        const { query } = await import('../db.js');
        const nodesRes = await query("SELECT id FROM nodes WHERE status = 'active'");
        for (const nodeRow of nodesRes.rows) {
            try {
                const docker = await getNodeConnection(nodeRow.id);
                const containers = await docker.listContainers();
                for (const containerInfo of containers) {
                    if (containerInfo.Names[0].startsWith('/ragenodes-')) {
                        const container = docker.getContainer(containerInfo.Id);
                        applyRageNodesBranding(container, containerInfo.Names[0]);
                    }
                }
            } catch (e) {}
        }
    } catch (e) {}
}

export async function getContainerStats(name, { force = false } = {}) {
    const cached = STATS_CACHE.get(name);
    const cacheAgeMs = cached?.updatedAt ? Date.now() - cached.updatedAt : Number.POSITIVE_INFINITY;

    if (!force && cached && cacheAgeMs < 15000) {
        return cached;
    }

    // 🚀 Intentar leer de Redis (donde worker-stats escribe periódicamente)
    if (!force && redisClient?.isOpen) {
        try {
            const rawRedis = await promiseWithTimeout(redisClient.get('ragenodes:stats:' + name), 300);
            if (rawRedis) {
                const parsed = JSON.parse(rawRedis);
                STATS_CACHE.set(name, parsed);
                return parsed;
            }
        } catch (e) {}
    }

    try {
        const docker = await getDockerForContainer(name);
        const container = docker.getContainer(name);
        // Timeout estricto de 2.5s para no bloquear peticiones HTTP concurrentes
        const stats = await promiseWithTimeout(container.stats({ stream: false }), 2500, 'Docker stats timeout');
        const result = await rustUtil.calculateStats(stats);

        if (result) {
            const normalized = {
                cpu: result.cpu ?? "0.0",
                ram: result.ram ?? "0.0",
                ramGb: result.ram_gb ?? result.ramGb ?? "0.0",
                net_rx: result.net_rx ?? "0",
                net_tx: result.net_tx ?? "0",
                disk: cached?.disk ?? "0.0",
                diskGb: cached?.diskGb ?? "0.0",
                updatedAt: Date.now()
            };
            STATS_CACHE.set(name, normalized);
            if (redisClient?.isOpen) {
                redisClient.setEx('ragenodes:stats:' + name, 60, JSON.stringify(normalized)).catch(() => {});
            }
            return normalized;
        }
    } catch (e) {
        if (cached) return cached;
    }

    return { cpu: "0.0", ram: "0.0", ramGb: "0.0", disk: cached?.disk ?? "0.0", diskGb: cached?.diskGb ?? "0.0", updatedAt: Date.now() };
}

/**
 * 🔍 BUSCADOR DE NODOS POR CONTENEDOR
 * Determina en qué nodo vive un contenedor consultando la DB.
 */

export async function sendCommandToContainer(containerName, command) {
    const docker = await getDockerForContainer(containerName);
    const container = docker.getContainer(containerName);
    // Para contenedores con Tty:true, hay que hacer attach al stdin
    const stream = await container.attach({
        stream: true,
        stdin: true,
        stdout: false,
        stderr: false,
        hijack: true,
    });
    stream.write(command + '\n');
    stream.end();
}

export function invalidateContainerCache(name) {
    CONTAINER_INSPECT_CACHE.delete(name);
}

export async function inspectContainer(name, { force = false } = {}) {
    const cached = CONTAINER_INSPECT_CACHE.get(name);
    if (!force && cached && cached.expiresAt > Date.now()) return cached.data;

    const docker = await getDockerForContainer(name);
    const data = await promiseWithTimeout(docker.getContainer(name).inspect(), 3000, 'Docker inspect timeout');
    if (CONTAINER_STATE_CACHE_MS > 0) {
        CONTAINER_INSPECT_CACHE.set(name, { data, expiresAt: Date.now() + CONTAINER_STATE_CACHE_MS });
    }
    return data;
}

export async function resolveContainerState(name, options = {}) {
    try {
        const data = await inspectContainer(name, options);
        return { exists: true, running: data.State.Running, inspect: data };
    } catch (e) { return { exists: false, running: false, inspect: null }; }
}

export async function startContainer(name) {
    try {
        invalidateContainerCache(name);
        const docker = await getDockerForContainer(name);
        const container = docker.getContainer(name);
        
        try {
            await container.start();
        } catch (startErr) {
            if (startErr.message && startErr.message.includes('network') && startErr.message.includes('not found')) {
                console.log(`⚠️ [NetworkHealing] Detectada red huérfana en ${name}. Intentando parcheo automático...`);
                try {
                    // Intentamos desconectar de cualquier red defectuosa
                    const inspect = await container.inspect();
                    const networks = Object.keys(inspect.NetworkSettings.Networks);
                    for (const net of networks) {
                        try { await docker.getNetwork(net).disconnect({ Container: name, Force: true }); } catch (e) {}
                    }
                    
                    // Conectamos a la red actual
                    await docker.getNetwork(config.dockerNetwork).connect({ Container: name });
                    console.log(`✅ [NetworkHealing] Contenedor ${name} reconectado a ${config.dockerNetwork}.`);
                    await container.start();
                } catch (patchErr) {
                    throw new Error(`Error en NetworkHealing: ${patchErr.message}`);
                }
            } else {
                throw startErr;
            }
        }
        
        invalidateContainerCache(name);

        try {
            const { query } = await import('../db.js');
            const { sendWebhookNotification } = await import('./discordWebhookService.js');
            const res = await query("SELECT name, discord_webhook_url, discord_webhook_events FROM servers WHERE container_name = $1", [name]);
            if (res.rowCount > 0) {
                const s = res.rows[0];
                await sendWebhookNotification(s.discord_webhook_url, s.discord_webhook_events, 'online', s.name);
            }
        } catch (e) {}
    } catch (e) { console.error(`Error starting ${name}:`, e.message); throw e; }
}

export async function stopContainer(name) {
    try {
        invalidateContainerCache(name);
        const docker = await getDockerForContainer(name);
        await docker.getContainer(name).stop();
        invalidateContainerCache(name);

        try {
            const { query } = await import('../db.js');
            const { sendWebhookNotification } = await import('./discordWebhookService.js');
            const res = await query("SELECT name, discord_webhook_url, discord_webhook_events FROM servers WHERE container_name = $1", [name]);
            if (res.rowCount > 0) {
                const s = res.rows[0];
                await sendWebhookNotification(s.discord_webhook_url, s.discord_webhook_events, 'offline', s.name);
            }
        } catch (e) {}
    } catch (e) { console.error(`Error stopping ${name}:`, e.message); }
}

export async function removeContainer(name) {
    try {
        invalidateContainerCache(name);
        const docker = await getDockerForContainer(name);
        const c = docker.getContainer(name);
        await c.stop().catch(() => {});
        await c.remove({ force: true });
        invalidateContainerCache(name);
    } catch (e) { console.error(`Error removing ${name}:`, e.message); }
}

export async function fetchContainerLogs(name) {
    try {
        const docker = await getDockerForContainer(name);
        const container = docker.getContainer(name);
        const buffer = await container.logs({
            stdout: true,
            stderr: true,
            tail: 1000,
            follow: false
        });

        // Dockerode returns multiplexed streams with 8-byte headers if TTY is false.
        let logs = "";
        let offset = 0;
        try {
            while (offset < buffer.length) {
                const header = buffer.readUInt8(offset);
                if (header < 1 || header > 3) break; // Not a valid stream header
                const size = buffer.readUInt32BE(offset + 4);
                if (offset + 8 + size > buffer.length) break;
                logs += buffer.toString('utf8', offset + 8, offset + 8 + size);
                offset += 8 + size;
            }
            if (logs === "" && buffer.length > 0) logs = buffer.toString('utf8');
        } catch (e) {
            logs = buffer.toString('utf8');
        }
        return logs;
    } catch (e) {
        return "";
    }
}

export async function toggleBlender(opts, action) {
    const docker = await getNodeConnection(opts.nodeId || 0);
    const shortId = opts.serverId.slice(0, 8);
    const containerName = `ragenodes-blender-${shortId}`;

    if (action === 'stop') {
        try {
            const container = docker.getContainer(containerName);
            await container.stop({ t: 5 });
            await container.remove({ force: true });
            return { success: true };
        } catch (e) {
            return { success: true };
        }
    }

    try {
        try {
            const existing = docker.getContainer(containerName);
            await existing.stop({ t: 2 }).catch(() => { });
            await existing.remove({ force: true }).catch(() => { });
        } catch (e) { }

        const container = await docker.createContainer({
            Image: config.blenderBaseImage,
            name: containerName,
            Env: [
                `PASSWORD=${opts.blenderPass}`,
                `SUBFOLDER=/blender/${shortId}/`,
                `TITLE=RageNodes 3D - ${shortId.toUpperCase()}`
            ],
            ExposedPorts: { '3000/tcp': {} },
            NetworkingConfig: {
                EndpointsConfig: {
                    'ragenodes_net': {}
                }
            },
            HostConfig: {
                Binds: [
                    `${opts.dataPath}:/config/workspace`
                ],
                PortBindings: {
                    '3000/tcp': [{ HostIp: "0.0.0.0", HostPort: String(opts.blenderPort) }]
                },
                RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
                Memory: 4 * 1024 * 1024 * 1024,
                NanoCpus: 2 * 10 ** 9, CpuShares: 2048,
                // CpuShares: 512,
                BlkioWeight: config.dockerBlkioWeight,
                ShmSize: 1024 * 1024 * 1024,
                SecurityOpt: ["no-new-privileges:true"]
            }
        });

        await container.start();
        return { success: true };
    } catch (e) {
        console.error(`[Blender] Error starting ${containerName}:`, e.message);
        throw e;
    }
}



// 🚀 ABSTRACCIÓN: Recreación genérica de contenedores (Multi-Nodo)


export const restartMinecraftContainer = (opts) => recreateContainer(opts.containerName, createMinecraftContainer, opts);
export const restartRustContainer = (opts) => recreateContainer(opts.containerName, createRustContainer, opts);
export const restartPalworldContainer = (opts) => recreateContainer(opts.containerName, createPalworldContainer, opts);
export const restartCS2Container = (opts) => recreateContainer(opts.containerName, createCS2Container, opts);
export const restartValheimContainer = (opts) => recreateContainer(opts.containerName, createValheimContainer, opts);
export const restartZomboidContainer = (opts) => recreateContainer(opts.containerName, createProjectZomboidContainer, opts);
export const restartARKContainer = (opts) => recreateContainer(opts.containerName, createARKContainer, opts);
export const restartFivemContainer = (opts) => recreateContainer(opts.containerName, createFivemContainer, opts);
export const restartDiscordBotContainer = (opts) => recreateContainer(opts.containerName, createDiscordBotContainer, opts);
export const restartWordPressContainer = (opts) => recreateContainer(opts.containerName, createWordPressContainer, opts);
export const restartDatabaseContainer = (opts) => recreateContainer(opts.containerName, createDatabaseContainer, opts);
export const restartSDTDContainer = (containerName, serverId, gamePort, plan, dataPath, nodeId) =>
    recreateContainer(containerName, (o) => createSDTDContainer(containerName, serverId, gamePort, plan, dataPath, o.nodeId), { nodeId });

export {
    createDiscordBotContainer,
    createWordPressContainer,
    createDatabaseContainer
};

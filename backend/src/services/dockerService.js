import { config } from '../config.js';
import { promiseWithTimeout } from '../utils/promiseWithTimeout.js';

export * from './dockerUtils.js';
export * from './dockerNodeService.js';
export * from './gameRuntimePolicy.js';
export * from './dockerTelemetryService.js';
export { promiseWithTimeout } from '../utils/promiseWithTimeout.js';
export * from './games/minecraft.js';
export * from './games/rust.js';
export * from './games/palworld.js';
export * from './games/cs2.js';
export * from './games/valheim.js';
export * from './games/zomboid.js';
export * from './games/ark.js';
export * from './games/fivem.js';
export * from './games/sdtd.js';

import { getDockerForContainer, recreateContainer } from './dockerUtils.js';
import { getNodeConnection } from './dockerNodeService.js';
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
import { findServerWebhookByContainer } from '../repositories/serverRepository.js';
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
    for (const key of CONTAINER_INSPECT_CACHE.keys()) {
        if (key.endsWith(`:${name}`)) CONTAINER_INSPECT_CACHE.delete(key);
    }
}

async function resolveDockerConnection(name, nodeId) {
    // When a caller already has the server row, its assigned node is
    // authoritative. A second name lookup can transiently select the local
    // daemon during provisioning and falsely report a remote container absent.
    return nodeId === undefined || nodeId === null
        ? getDockerForContainer(name)
        : getNodeConnection(nodeId);
}

export async function inspectContainer(name, { force = false, nodeId } = {}) {
    const cacheKey = nodeId === undefined || nodeId === null ? name : `${nodeId}:${name}`;
    const cached = CONTAINER_INSPECT_CACHE.get(cacheKey);
    if (!force && cached && cached.expiresAt > Date.now()) return cached.data;

    const docker = await resolveDockerConnection(name, nodeId);
    const data = await promiseWithTimeout(docker.getContainer(name).inspect(), 3000, 'Docker inspect timeout');
    if (CONTAINER_STATE_CACHE_MS > 0) {
        CONTAINER_INSPECT_CACHE.set(cacheKey, { data, expiresAt: Date.now() + CONTAINER_STATE_CACHE_MS });
    }
    return data;
}

export async function resolveContainerState(name, options = {}) {
    try {
        const data = await inspectContainer(name, options);
        return { exists: true, running: data.State.Running, inspect: data };
    } catch (e) { return { exists: false, running: false, inspect: null }; }
}

export async function startContainer(name, { nodeId } = {}) {
    try {
        invalidateContainerCache(name);
        const docker = await resolveDockerConnection(name, nodeId);
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
            const { sendWebhookNotification } = await import('./discordWebhookService.js');
            const s = await findServerWebhookByContainer(name);
            if (s) {
                await sendWebhookNotification(s.discord_webhook_url, s.discord_webhook_events, 'online', s.name);
            }
        } catch (e) {}
    } catch (e) { console.error(`Error starting ${name}:`, e.message); throw e; }
}

export async function stopContainer(name, { nodeId } = {}) {
    try {
        invalidateContainerCache(name);
        const docker = await resolveDockerConnection(name, nodeId);
        await docker.getContainer(name).stop();
        invalidateContainerCache(name);

        try {
            const { sendWebhookNotification } = await import('./discordWebhookService.js');
            const s = await findServerWebhookByContainer(name);
            if (s) {
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

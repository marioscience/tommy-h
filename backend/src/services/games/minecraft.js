import { BaseGameService } from './BaseGameService.js';
import { GameFactory } from './GameFactory.js';
import { runRemoteCommand, sh } from '../dockerUtils.js';
import { config } from '../../config.js';

const MINECRAFT_IMAGES = {
    java11: 'itzg/minecraft-server:java11@sha256:b71159ed67e389fac6cbdc2e7205167e210e9012858a9a47cd1d64cd8de28241',
    java17: 'itzg/minecraft-server:java17@sha256:032c6ac2c1a418bde85e19a54222fc1c3220eacc62226e08586cc4d5b7b0c676',
    java21: 'itzg/minecraft-server:java21@sha256:2849cd16063903439cd34c6eaddbcecc8914367ac9334c9757f6a7ea5007273c',
    java25: config.minecraftBaseImage
};

const MINECRAFT_IDENTITY_FILE = '.ragenodes-minecraft-identity.json';
const DEFAULT_MINECRAFT_VERSION = '1.21.4';
const ALLOWED_MINECRAFT_TYPES = new Set(['PAPER', 'FORGE', 'FABRIC', 'NEOFORGE', 'PURPUR', 'VANILLA']);

const MIB = 1024 * 1024;
const MINIMUM_JVM_MEMORY_MB = 512;
const MINIMUM_NATIVE_HEADROOM_MB = 768;

export function calculateMinecraftJvmMemoryMb(memoryBytes) {
    const totalMb = Math.max(
        MINIMUM_JVM_MEMORY_MB + MINIMUM_NATIVE_HEADROOM_MB,
        Math.floor(Number(memoryBytes || 4 * 1024 * 1024 * 1024) / MIB)
    );
    // Forge, Netty and the container runtime consume memory outside the Java
    // heap. Reserving both 25% and at least 768 MiB prevents a healthy JVM
    // from sitting at the cgroup ceiling and being terminated with exit 137.
    return Math.max(
        MINIMUM_JVM_MEMORY_MB,
        Math.min(Math.floor(totalMb * 0.75), totalMb - MINIMUM_NATIVE_HEADROOM_MB)
    );
}

export function normalizeMinecraftIdentity(version, type) {
    const normalizedVersion = String(version || DEFAULT_MINECRAFT_VERSION).trim();
    const normalizedType = String(type || 'PAPER').trim().toUpperCase();
    if (!/^\d+(?:\.\d+){1,2}$/.test(normalizedVersion)) {
        throw new Error('La versión de Minecraft debe ser explícita y no puede ser LATEST.');
    }
    if (!ALLOWED_MINECRAFT_TYPES.has(normalizedType)) {
        throw new Error(`Tipo de servidor Minecraft no permitido: ${normalizedType}`);
    }
    return { version: normalizedVersion, type: normalizedType };
}

export function resolveMinecraftIdentity(requested, locked, serverId) {
    const requestedIdentity = normalizeMinecraftIdentity(requested.version, requested.type);
    if (!locked || typeof locked !== 'object') return requestedIdentity;

    const lockedIdentity = normalizeMinecraftIdentity(locked.version, locked.type);
    const sameServer = locked.serverId
        ? String(locked.serverId) === String(serverId)
        : lockedIdentity.version === requestedIdentity.version
            && lockedIdentity.type === requestedIdentity.type;

    return sameServer ? lockedIdentity : requestedIdentity;
}

/**
 * ⛏️ MinecraftService (Módulo 3: POO & Herencia)
 */
export class MinecraftService extends BaseGameService {
    constructor() {
        super('minecraft', config.minecraftBaseImage);
    }

    resolveTargetImage(version = 'LATEST') {
        let imageTag = 'java17';
        if (version.startsWith('1.8') || version.startsWith('1.12') || version.startsWith('1.16')) imageTag = 'java11';
        if (version.startsWith('1.20.5') || version.startsWith('1.20.6') || version.startsWith('1.21') || version.startsWith('1.22') || version.startsWith('1.23') || version.startsWith('1.24') || version.startsWith('1.25')) imageTag = 'java21';
        if (version.startsWith('26') || version.startsWith('1.26') || version === 'LATEST') imageTag = 'java25';
        return MINECRAFT_IMAGES[imageTag] || MINECRAFT_IMAGES.java21;
    }

    buildEnvironment(opts) {
        const memoryMb = calculateMinecraftJvmMemoryMb(opts.plan?.memoryBytes);
        const jvmMemory = `${memoryMb}M`;
        const { version, type } = normalizeMinecraftIdentity(opts.mcVersion, opts.mcType);

        return [
            'EULA=TRUE',
            `VERSION=${version}`,
            `TYPE=${type}`,
            `DIFFICULTY=${opts.difficulty || 'normal'}`,
            `MAX_PLAYERS=${opts.maxPlayers || 20}`,
            `SERVER_NAME=${opts.serverName}`,
            `MEMORY=${jvmMemory}`,
            `INIT_MEMORY=${jvmMemory}`,
            `MAX_MEMORY=${jvmMemory}`,
            `GID=${config.gameContainerSharedGid}`,
            'UMASK=0002',
            'USE_AIKAR_FLAGS=true',
            'ENABLE_RCON=false',
            // Los servidores alojados deben permanecer activos aunque no haya
            // jugadores. La pausa nativa puede interrumpir handshakes largos
            // (especialmente Forge) cuando el acceso pasa por el proxy L4.
            'PAUSE_WHEN_EMPTY_SECONDS=-1',
            'OVERRIDE_SERVER_PROPERTIES=false',
            'ONLINE_MODE=TRUE',
            'ENFORCE_SECURE_PROFILE=TRUE'
        ];
    }

    buildVolumes(opts) {
        return [`${opts.dataPath}:/data`];
    }

    buildPortBindings(opts) {
        const gamePort = opts.gamePort || 25565;
        return {
            exposed: {
                '25565/tcp': {},
                '25565/udp': {}
            },
            bindings: {
                '25565/tcp': [{ HostIp: '0.0.0.0', HostPort: String(gamePort) }],
                '25565/udp': [{ HostIp: '0.0.0.0', HostPort: String(gamePort) }]
            },
            proxiedPorts: ['25565/tcp', '25565/udp']
        };
    }

    async createContainer(opts) {
        const identityPath = `${opts.dataPath}/${MINECRAFT_IDENTITY_FILE}`;
        const requestedIdentity = normalizeMinecraftIdentity(opts.mcVersion, opts.mcType);
        let identity = requestedIdentity;
        try {
            const result = await runRemoteCommand(opts.nodeId || 0, sh`cat ${identityPath}`);
            if (result && typeof result.stdout === 'string' && result.stdout.trim()) {
                const locked = JSON.parse(result.stdout);
                identity = resolveMinecraftIdentity(requestedIdentity, locked, opts.serverId);
                if (identity.version !== requestedIdentity.version || identity.type !== requestedIdentity.type) {
                    console.warn(
                        `[Minecraft] Se ignoró un cambio de identidad para ${opts.containerName}; ` +
                        `se conserva ${identity.type} ${identity.version}.`
                    );
                }
            }
        } catch (error) {
            if (!String(error?.message || '').includes('No such file')) {
                console.warn(`[Minecraft] No se pudo leer la identidad de ${opts.containerName}: ${error.message}`);
            }
        }
        opts.mcVersion = identity.version;
        opts.mcType = identity.type;
        opts.customImage = this.resolveTargetImage(identity.version);
        const container = await super.createContainer(opts);
        const serializedIdentity = JSON.stringify({
            version: identity.version,
            type: identity.type,
            serverId: opts.serverId,
            locked: true
        });
        await runRemoteCommand(opts.nodeId || 0, sh`printf '%s' ${serializedIdentity} > ${identityPath}`);
        return container;
    }
}

// Instancia singleton y registro en la fábrica
export const minecraftService = new MinecraftService();
GameFactory.register('minecraft', minecraftService);

// Exportación retrocompatible
export async function createMinecraftContainer(opts) {
    return minecraftService.createContainer(opts);
}

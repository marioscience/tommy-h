import { BaseGameService } from './BaseGameService.js';
import { GameFactory } from './GameFactory.js';
import { runRemoteCommand, sh } from '../dockerUtils.js';
import { config } from '../../config.js';

const MINECRAFT_IMAGES = {
    java11: 'itzg/minecraft-server:java11@sha256:b71159ed67e389fac6cbdc2e7205167e210e9012858a9a47cd1d64cd8de28241',
    java17: 'itzg/minecraft-server:java17@sha256:032c6ac2c1a418bde85e19a54222fc1c3220eacc62226e08586cc4d5b7b0c676',
    java21: 'itzg/minecraft-server:java21@sha256:2849cd16063903439cd34c6eaddbcecc8914367ac9334c9757f6a7ea5007273c',
    java25: config.minecraftBaseImage || 'itzg/minecraft-server:java21'
};

/**
 * ⛏️ MinecraftService (Módulo 3: POO & Herencia)
 */
export class MinecraftService extends BaseGameService {
    constructor() {
        super('minecraft', config.minecraftBaseImage || 'itzg/minecraft-server:java21');
    }

    resolveTargetImage(version = 'LATEST') {
        let imageTag = 'java17';
        if (version.startsWith('1.8') || version.startsWith('1.12') || version.startsWith('1.16')) imageTag = 'java11';
        if (version.startsWith('1.20.5') || version.startsWith('1.20.6') || version.startsWith('1.21') || version.startsWith('1.22') || version.startsWith('1.23') || version.startsWith('1.24') || version.startsWith('1.25')) imageTag = 'java21';
        if (version.startsWith('26') || version.startsWith('1.26') || version === 'LATEST') imageTag = 'java25';
        return MINECRAFT_IMAGES[imageTag] || MINECRAFT_IMAGES.java21;
    }

    buildEnvironment(opts) {
        const memoryMb = Math.floor((opts.plan?.memoryBytes || 4 * 1024 * 1024 * 1024) / 1024 / 1024 * 0.85);
        const jvmMemory = `${memoryMb}M`;
        const version = opts.mcVersion || 'LATEST';

        return [
            'EULA=TRUE',
            `VERSION=${version}`,
            `TYPE=${opts.mcType || 'PAPER'}`,
            `DIFFICULTY=${opts.difficulty || 'normal'}`,
            `MAX_PLAYERS=${opts.maxPlayers || 20}`,
            `SERVER_NAME=${opts.serverName}`,
            `MEMORY=${jvmMemory}`,
            `INIT_MEMORY=${jvmMemory}`,
            `MAX_MEMORY=${jvmMemory}`,
            'USE_AIKAR_FLAGS=true',
            'ENABLE_RCON=false',
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
            }
        };
    }

    async createContainer(opts) {
        let version = opts.mcVersion || 'LATEST';
        if (version === 'LATEST') {
            try {
                const { stdout } = await runRemoteCommand(opts.nodeId || 0, sh`ls -1 ${opts.dataPath} || true`);
                const match = stdout?.match(/(?:paper|purpur|spigot|forge|fabric|minecraft_server\.?)-?(\d+\.\d+(\.\d+)?)/i);
                if (match && match[1]) {
                    version = match[1];
                    opts.mcVersion = version;
                }
            } catch (e) {}
        }
        opts.customImage = this.resolveTargetImage(version);
        return super.createContainer(opts);
    }
}

// Instancia singleton y registro en la fábrica
export const minecraftService = new MinecraftService();
GameFactory.register('minecraft', minecraftService);

// Exportación retrocompatible
export async function createMinecraftContainer(opts) {
    return minecraftService.createContainer(opts);
}

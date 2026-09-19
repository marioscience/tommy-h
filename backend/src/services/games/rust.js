import { BaseGameService } from './BaseGameService.js';
import { GameFactory } from './GameFactory.js';
import { cloneFromMasterTemplate } from '../dockerUtils.js';
import { deriveServiceIdentifier, deriveServicePassword } from '../gameRuntimePolicy.js';
import { config } from '../../config.js';

/**
 * ☢️ RustGameService (Módulo 3: POO & Herencia)
 */
export class RustGameService extends BaseGameService {
    constructor() {
        super('rust', config.rustBaseImage);
    }

    async prepareDirectory(nodeId, dataPath) {
        await super.prepareDirectory(nodeId, dataPath);
        await cloneFromMasterTemplate('rust', dataPath, nodeId);
    }

    buildEnvironment(opts) {
        const identity = deriveServiceIdentifier('rust', opts.serverId || opts.containerName, 24);
        const rconPassword = deriveServicePassword('rust-rcon', opts.serverId || opts.containerName);
        return [
            `SERVER_NAME=${opts.serverName}`,
            'SERVER_PORT=28015',
            'RCON_PORT=28016',
            `RCON_PASSWORD=${rconPassword}`,
            `SERVER_IDENTITY=${identity}`,
            'OXIDE_ENABLED=true',
            'UPDATE_ON_START=true',
            'STARTUP_ARGUMENTS=+server.queryport 28017'
        ];
    }

    buildVolumes(opts) {
        return [`${opts.dataPath}:/steamcmd/rust`];
    }

    buildPortBindings(opts) {
        const gamePort = opts.gamePort || 28015;
        return {
            exposed: {
                '28015/tcp': {},
                '28015/udp': {},
                '28016/tcp': {},
                '28016/udp': {},
                '28017/udp': {}
            },
            bindings: {
                '28015/tcp': [{ HostIp: '0.0.0.0', HostPort: String(gamePort) }],
                '28015/udp': [{ HostIp: '0.0.0.0', HostPort: String(gamePort) }],
                '28016/tcp': [{ HostIp: '0.0.0.0', HostPort: String(gamePort + 1) }],
                '28016/udp': [{ HostIp: '0.0.0.0', HostPort: String(gamePort + 1) }],
                '28017/udp': [{ HostIp: '0.0.0.0', HostPort: String(gamePort + 2) }]
            },
            proxiedPorts: ['28015/tcp', '28015/udp', '28016/tcp', '28016/udp', '28017/udp']
        };
    }
}

// Instancia singleton y registro en la fábrica
export const rustGameService = new RustGameService();
GameFactory.register('rust', rustGameService);

// Exportación retrocompatible
export async function createRustContainer(opts) {
    return rustGameService.createContainer(opts);
}

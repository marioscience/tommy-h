import { BaseGameService } from './BaseGameService.js';
import { GameFactory } from './GameFactory.js';
import { cloneFromMasterTemplate, deriveServiceIdentifier } from '../dockerUtils.js';
import { config } from '../../config.js';

/**
 * ☢️ RustGameService (Módulo 3: POO & Herencia)
 */
export class RustGameService extends BaseGameService {
    constructor() {
        super('rust', config.rustBaseImage || 'didstopia/rust-server:latest');
    }

    async prepareDirectory(nodeId, dataPath) {
        await super.prepareDirectory(nodeId, dataPath);
        await cloneFromMasterTemplate('rust', dataPath, nodeId);
    }

    buildEnvironment(opts) {
        const identity = deriveServiceIdentifier('rust', opts.serverId || opts.containerName, 24);
        return [
            `RUST_SERVER_NAME=${opts.serverName}`,
            `RUST_SERVER_STARTUP_ARGUMENTS=-batchmode +server.port 28015 +server.queryport 28017 +server.identity "${identity}"`,
            'RUST_OXIDE=1',
            'RUST_UPDATE_CHECKING=1',
            'RUST_UPDATE_BRANCH=public'
        ];
    }

    buildVolumes(opts) {
        return [`${opts.dataPath}:/steamcmd/rust`];
    }

    buildPortBindings(opts) {
        const gamePort = opts.gamePort || 28015;
        return {
            exposed: {
                '28015/udp': {},
                '28016/tcp': {},
                '28017/udp': {}
            },
            bindings: {
                '28015/udp': [{ HostIp: '0.0.0.0', HostPort: String(gamePort) }],
                '28016/tcp': [{ HostIp: '0.0.0.0', HostPort: String(gamePort + 1) }],
                '28017/udp': [{ HostIp: '0.0.0.0', HostPort: String(gamePort + 2) }]
            }
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

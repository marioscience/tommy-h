import { BaseGameService } from './BaseGameService.js';
import { GameFactory } from './GameFactory.js';
import { getRagenodesTunnelHostname } from '../cloudflareService.js';
import { config } from '../../config.js';

/**
 * 🚗 FiveMService (Módulo 3: POO & Herencia)
 */
export class FiveMService extends BaseGameService {
    constructor() {
        super('fivem', config.fivemBaseImage || 'ragenodes-fivem-base:1.0.0-local');
    }

    async prepareDirectory(nodeId, dataPath) {
        await super.prepareDirectory(nodeId, dataPath, ['txData']);
    }

    buildEnvironment(opts) {
        const txHostUrl = opts.txadminPort
            ? `https://${getRagenodesTunnelHostname(opts.containerName || 'srv', opts.txadminPort, '', 'tx')}/`
            : null;

        return [
            `TXADMIN_PORT=${opts.txadminPort}`,
            `FIVEM_PORT=${opts.fivemPort}`,
            `TXHOST_TXA_PORT=${opts.txadminPort}`,
            `TXHOST_FXS_PORT=${opts.fivemPort}`,
            `TXHOST_INTERFACE=0.0.0.0`,
            `TXHOST_DATA_PATH=/opt/fivem/txData`,
            `TXHOST_GAME_NAME=fivem`,
            `TXHOST_IGNORE_DEPRECATED_CONFIGS=true`,
            ...(txHostUrl ? [`TXHOST_TXA_URL=${txHostUrl}`] : []),
            ...(opts.dbName ? [`DB_NAME=${opts.dbName}`] : []),
            ...(opts.dbUser ? [`DB_USER=${opts.dbUser}`] : []),
            ...(opts.dbPass ? [`DB_PASS=${opts.dbPass}`] : []),
            ...(opts.dbName ? [`TXHOST_DEFAULT_DBNAME=${opts.dbName}`] : []),
            ...(opts.dbUser ? [`TXHOST_DEFAULT_DBUSER=${opts.dbUser}`] : []),
            ...(opts.dbPass ? [`TXHOST_DEFAULT_DBPASS=${opts.dbPass}`] : []),
            `TXHOST_DEFAULT_DBHOST=mariadb`,
            `TXHOST_DEFAULT_DBPORT=3306`,
            `SERVER_NAME=${opts.serverName}`,
            `LICENSE_KEY=${opts.licenseKey}`,
            `FIVEM_PUBLIC_HOST=${config.fivemPublicHost}`
        ];
    }

    buildVolumes(opts) {
        return [
            `${opts.dataPath}:/data`,
            `${opts.dataPath}/txData:/opt/fivem/txData`
        ];
    }

    buildPortBindings(opts) {
        return {
            exposed: {
                [`${opts.fivemPort}/tcp`]: {},
                [`${opts.fivemPort}/udp`]: {},
                [`${opts.txadminPort}/tcp`]: {}
            },
            bindings: {
                [`${opts.fivemPort}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: String(opts.fivemPort) }],
                [`${opts.fivemPort}/udp`]: [{ HostIp: "0.0.0.0", HostPort: String(opts.fivemPort) }],
                [`${opts.txadminPort}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: String(opts.txadminPort) }]
            }
        };
    }
}

// Instancia singleton y registro en la fábrica
export const fivemService = new FiveMService();
GameFactory.register('fivem', fivemService);

// Exportación retrocompatible
export async function createFivemContainer(opts) {
    return fivemService.createContainer(opts);
}

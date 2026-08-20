import os from 'os';
import { getNodeConnection, runRemoteCommand, GAME_SECURITY_CONFIG, applyRageNodesBranding, sh } from '../dockerUtils.js';
import { config } from '../../config.js';

/**
 * 🏛️ BaseGameService (Módulo 3 & 4: POO y Patrón Template Method)
 * Clase base abstracta que encapsula el ciclo de vida, configuración de seguridad,
 * volúmenes y red para cualquier servidor de juego en RageNodes.
 */
export class BaseGameService {
    /**
     * @param {string} gameId - Identificador único del juego (ej: 'fivem', 'rust', 'minecraft')
     * @param {string} defaultImage - Imagen Docker base para el juego
     */
    constructor(gameId, defaultImage) {
        if (new.target === BaseGameService) {
            throw new TypeError("No se puede instanciar la clase abstracta BaseGameService directamente.");
        }
        this.gameId = gameId;
        this.defaultImage = defaultImage;
    }

    /**
     * Prepara directorios remotos con permisos estándar seguros (1000:1000).
     */
    async prepareDirectory(nodeId, dataPath, subdirs = []) {
        await runRemoteCommand(nodeId || 0, sh`mkdir -p ${dataPath} && chown -R 1000:1000 ${dataPath}`);
        for (const sub of subdirs) {
            await runRemoteCommand(nodeId || 0, sh`mkdir -p "${dataPath}/${sub}"`);
        }
        try {
            await runRemoteCommand(nodeId || 0, sh`chown -R 1000:1000 ${dataPath} && chmod -R u=rwX,g=rX,o= ${dataPath}`);
        } catch (e) {}
    }

    /**
     * Construye las variables de entorno específicas del juego.
     */
    buildEnvironment(opts) {
        return [];
    }

    /**
     * Construye los montajes de volúmenes (Binds).
     */
    buildVolumes(opts) {
        return [`${opts.dataPath}:/data`];
    }

    /**
     * Construye la exposición y mapeo de puertos.
     */
    buildPortBindings(opts) {
        return { exposed: {}, bindings: {} };
    }

    /**
     * Construye la configuración de recursos y seguridad para HostConfig.
     */
    buildHostConfig(opts, portBindings, binds) {
        const hostCpuCount = Math.max(1, os.cpus()?.length || 4);
        const rawNanoCpus = opts.plan?.nanoCpus || 2 * 10**9;
        const nanoCpus = Math.min(rawNanoCpus, hostCpuCount * 10**9);
        const memoryBytes = opts.plan?.memoryBytes || 4 * 1024 * 1024 * 1024;

        return {
            Binds: binds,
            PortBindings: portBindings.bindings,
            RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
            Memory: memoryBytes,
            NanoCpus: nanoCpus,
            CpuShares: Math.round((nanoCpus / 10**9) * 1024),
            BlkioWeight: config.dockerBlkioWeight || 100,
            ExtraHosts: ["host.docker.internal:host-gateway"],
            ...GAME_SECURITY_CONFIG
        };
    }

    /**
     * Hook posterior a la creación e inicio del contenedor.
     */
    async afterStart(container, opts) {
        applyRageNodesBranding(container, opts.containerName);
        try {
            const { query } = await import('../../db.js');
            const { sendWebhookNotification } = await import('../discordWebhookService.js');
            const res = await query("SELECT name, discord_webhook_url, discord_webhook_events FROM servers WHERE container_name = $1", [opts.containerName]);
            if (res.rowCount > 0) {
                const s = res.rows[0];
                await sendWebhookNotification(s.discord_webhook_url, s.discord_webhook_events, 'online', s.name);
            }
        } catch (e) {}
    }

    /**
     * 🚀 Template Method: Orquestación completa de la creación del contenedor.
     */
    async createContainer(opts) {
        const docker = await getNodeConnection(opts.nodeId || 0);
        await this.prepareDirectory(opts.nodeId, opts.dataPath);

        const env = this.buildEnvironment(opts);
        const binds = this.buildVolumes(opts);
        const ports = this.buildPortBindings(opts);
        const hostConfig = this.buildHostConfig(opts, ports, binds);

        const image = opts.customImage || this.defaultImage;

        const container = await docker.createContainer({
            Image: image,
            name: opts.containerName,
            Env: env,
            ExposedPorts: ports.exposed,
            NetworkingConfig: {
                EndpointsConfig: {
                    [config.dockerNetwork]: {}
                }
            },
            HostConfig: hostConfig
        });

        await container.start();
        await this.afterStart(container, opts);

        return container;
    }
}

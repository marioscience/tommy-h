import os from 'os';
import path from 'node:path';
import { getNodeConnection, runRemoteCommand, GAME_SECURITY_CONFIG, applyRageNodesBranding, sh } from '../dockerUtils.js';
import { config } from '../../config.js';

export function resolveDataSubdirectory(dataPath, subdir) {
    if (typeof dataPath !== 'string' || !path.posix.isAbsolute(dataPath)) {
        throw new TypeError('La ruta de datos debe ser absoluta.');
    }
    if (typeof subdir !== 'string' || !subdir || path.posix.isAbsolute(subdir)) {
        throw new TypeError('El subdirectorio debe ser una ruta relativa no vacía.');
    }

    const base = path.posix.normalize(dataPath).replace(/\/+$/, '');
    const resolved = path.posix.normalize(path.posix.join(base, subdir));
    if (!resolved.startsWith(`${base}/`) || resolved === base) {
        throw new TypeError('El subdirectorio no puede salir de la ruta de datos.');
    }
    return resolved;
}

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
            const subdirPath = resolveDataSubdirectory(dataPath, sub);
            await runRemoteCommand(nodeId || 0, sh`mkdir -p ${subdirPath}`);
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

        const hostConfig = {
            Binds: binds,
            PortBindings: portBindings.bindings,
            RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
            Memory: memoryBytes,
            NanoCpus: nanoCpus,
            CpuShares: Math.round((nanoCpus / 10**9) * 1024),
            ExtraHosts: ["host.docker.internal:host-gateway"],
            ...GAME_SECURITY_CONFIG
        };

        if (config.dockerBlkioWeight && Number(config.dockerBlkioWeight) > 0) {
            hostConfig.BlkioWeight = Number(config.dockerBlkioWeight);
        }

        return hostConfig;
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

        const imageName = opts.customImage || this.defaultImage;

        // 🚀 Verificación e Ingesta Automática de Imagen Docker si no existe en el nodo
        try {
            await docker.getImage(imageName).inspect();
        } catch (inspectErr) {
            console.log(`[BaseGameService] 📥 Descargando imagen Docker ${imageName} en el nodo ${opts.nodeId || 0}...`);
            try {
                const stream = await docker.pull(imageName);
                await new Promise((resolve, reject) => {
                    docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
                });
            } catch (pullErr) {
                console.warn(`⚠️ [BaseGameService] No se pudo descargar la imagen ${imageName}: ${pullErr.message}`);
            }
        }

        const container = await docker.createContainer({
            name: opts.containerName,
            Image: imageName,
            Env: env,
            ExposedPorts: ports.exposed,
            HostConfig: hostConfig,
            Labels: {
                "ragenodes.server_id": String(opts.serverId),
                "ragenodes.game": String(this.gameId)
            }
        });

        await container.start();
        await this.afterStart(container, opts);
        return container;
    }
}

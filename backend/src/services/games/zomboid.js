import { getNodeConnection, runRemoteCommand, cloneFromMasterTemplate, sh } from '../dockerUtils.js';
import { GAME_SECURITY_CONFIG, deriveServicePassword } from '../gameRuntimePolicy.js';
import { config } from '../../config.js';
import { prepareGameProxyBindings } from '../gameProxyPolicy.js';
import fs from 'fs/promises';
import path from 'path';

const ZOMBOID_RCON_CONTAINER_PORT = 27015;

function normalizeModList(value, pattern) {
    return String(value || '')
        .split(';')
        .map((entry) => entry.trim())
        .filter((entry) => entry && pattern.test(entry))
        .join(';');
}

export function parseProjectZomboidMods(content = '') {
    return {
        modNames: normalizeModList(content.match(/^Mods=([^\r\n]*)/m)?.[1], /^[A-Za-z0-9_.-]+$/),
        workshopIds: normalizeModList(content.match(/^WorkshopItems=([^\r\n]*)/m)?.[1], /^\d+$/)
    };
}

async function readProjectZomboidMods(opts) {
    const iniPath = path.join(opts.dataPath, 'Zomboid', 'Server', `${opts.serverName}.ini`);
    try {
        return parseProjectZomboidMods(await fs.readFile(iniPath, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return { modNames: '', workshopIds: '' };
        throw error;
    }
}

export function buildProjectZomboidRuntime(opts) {
    const password = deriveServicePassword('zomboid-admin', opts.serverId || opts.containerName);
    return {
        environment: [
            `SERVER_NAME=${opts.serverName}`,
            `ADMIN_PASSWORD=${password}`,
            `RCON_PORT=${ZOMBOID_RCON_CONTAINER_PORT}`,
            `RCON_PASSWORD=${password}`,
            `MOD_NAMES=${opts.modNames || ''}`,
            `MOD_WORKSHOP_IDS=${opts.workshopIds || ''}`,
            'TZ=UTC'
        ],
        exposedPorts: {
            '16261/udp': {},
            '16262/udp': {},
            [`${ZOMBOID_RCON_CONTAINER_PORT}/tcp`]: {}
        },
        publicBindings: {
            '16261/udp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort) }],
            '16262/udp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort + 1) }],
            [`${ZOMBOID_RCON_CONTAINER_PORT}/tcp`]: [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort + 1) }]
        }
    };
}

export async function createProjectZomboidContainer(opts) {
    const docker = await getNodeConnection(opts.nodeId || 0);
    const templateApplied = await cloneFromMasterTemplate('zomboid', opts.dataPath, opts.nodeId);
    if (!templateApplied) {
        throw new Error('La plantilla validada de Project Zomboid no está disponible. El despliegue se detuvo antes de crear un contenedor incompleto.');
    }
    // Prepare mutable state only after cloning. Creating it first makes the
    // template cloner treat a new instance as populated and skip the master.
    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${opts.dataPath}/Zomboid/mods && chown -R 1000:1000 ${opts.dataPath}`);

    try { await docker.getImage(config.zomboidBaseImage).inspect(); }
    catch (e) {
        console.log(`🚚 [Docker] Descargando imagen ${config.zomboidBaseImage}...`);
        const stream = await docker.pull(config.zomboidBaseImage);
        await new Promise((resolve, reject) => { docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res)); });
    }

    const persistedMods = await readProjectZomboidMods(opts);
    const runtime = buildProjectZomboidRuntime({ ...opts, ...persistedMods });
    const proxy = prepareGameProxyBindings(runtime.publicBindings, { enabled: config.oxideGameProxyEnabled, backendOffset: config.gameBackendPortOffset, backendBindIp: config.gameBackendBindIp });
    const container = await docker.createContainer({
        Image: config.zomboidBaseImage,
        name: opts.containerName,
        Env: runtime.environment,
        ExposedPorts: runtime.exposedPorts,
        Tty: true,
        OpenStdin: true,
        NetworkingConfig: { EndpointsConfig: { [config.dockerNetwork]: {} } },
        HostConfig: {
            Binds: [
                `${opts.dataPath}/serverfiles:/home/steam/ZomboidDedicatedServer`,
                `${opts.dataPath}/Zomboid:/home/steam/Zomboid`
            ],
            PortBindings: proxy.bindings,
            RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
            Memory: opts.plan.memoryBytes,
            NanoCpus: opts.plan.nanoCpus, CpuShares: Math.round((opts.plan.nanoCpus / 10**9) * 1024),
            BlkioWeight: config.dockerBlkioWeight,
            ...GAME_SECURITY_CONFIG
        },
        Labels: {
            'ragenodes.server_id': String(opts.serverId),
            'ragenodes.game': 'zomboid',
            ...proxy.labels
        }
    });

    await container.start();
    return container;
}

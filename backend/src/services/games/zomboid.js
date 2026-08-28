import { getNodeConnection, runRemoteCommand, localDocker, GAME_SECURITY_CONFIG, cloneFromMasterTemplate, deriveServicePassword, sh } from '../dockerUtils.js';
import { config } from '../../config.js';
import { prepareGameProxyBindings } from '../gameProxyPolicy.js';

export async function createProjectZomboidContainer(opts) {
    const docker = await getNodeConnection(opts.nodeId || 0);
    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${opts.dataPath}/Zomboid/mods && chown -R 1000:1000 ${opts.dataPath}`);
    await cloneFromMasterTemplate('zomboid', opts.dataPath, opts.nodeId);

    try { await docker.getImage(config.zomboidBaseImage).inspect(); }
    catch (e) {
        console.log(`🚚 [Docker] Descargando imagen ${config.zomboidBaseImage}...`);
        const stream = await docker.pull(config.zomboidBaseImage);
        await new Promise((resolve, reject) => { docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res)); });
    }

    const publicBindings = {
        '16261/udp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort) }],
        '16262/udp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort + 1) }]
    };
    const proxy = prepareGameProxyBindings(publicBindings, { enabled: config.oxideGameProxyEnabled, backendOffset: config.gameBackendPortOffset, backendBindIp: config.gameBackendBindIp });
    const container = await docker.createContainer({
        Image: config.zomboidBaseImage,
        name: opts.containerName,
        Env: [
            `SERVER_NAME=${opts.serverName}`,
            `ADMIN_PASSWORD=${deriveServicePassword('zomboid-admin', opts.serverId || opts.containerName)}`,
            'TZ=UTC'
        ],
        ExposedPorts: { '16261/udp': {}, '16262/udp': {} },
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

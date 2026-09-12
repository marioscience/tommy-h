import { getNodeConnection, runRemoteCommand, GAME_SECURITY_CONFIG, cloneFromMasterTemplate, deriveServicePassword, sh } from '../dockerUtils.js';
import { config } from '../../config.js';
import { prepareGameProxyBindings } from '../gameProxyPolicy.js';

export async function createPalworldContainer(opts) {
    const docker = await getNodeConnection(opts.nodeId || 0);
    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${opts.dataPath} && chown -R 1000:1000 ${opts.dataPath}`);
    await cloneFromMasterTemplate('palworld', opts.dataPath, opts.nodeId);

    try {
        await docker.getImage(config.palworldBaseImage).inspect();
    } catch (e) {
        console.log(`🚚 [Docker] Descargando imagen ${config.palworldBaseImage}...`);
        const stream = await docker.pull(config.palworldBaseImage);
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
        });
    }

    const proxy = prepareGameProxyBindings({
        '8211/udp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort) }],
        [`${opts.gamePort + 1}/tcp`]: [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort + 1) }],
        [`${opts.gamePort + 2}/udp`]: [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort + 2) }]
    }, { enabled: config.oxideGameProxyEnabled, backendOffset: config.gameBackendPortOffset, backendBindIp: config.gameBackendBindIp });
    const container = await docker.createContainer({
        Image: config.palworldBaseImage,
        name: opts.containerName,
        Env: [
            `SERVER_NAME=${opts.serverName}`,
            `PLAYERS=${opts.maxPlayers || 32}`,
            `ADMIN_PASSWORD=${opts.adminPassword || deriveServicePassword('palworld-admin', opts.serverId || opts.containerName)}`,
            `RCON_ENABLED=true`,
            `RCON_PORT=${opts.gamePort + 1}`,
            `QUERY_PORT=${opts.gamePort + 2}`,
            'TZ=UTC'
        ],
        ExposedPorts: {
            '8211/udp': {},
            [`${opts.gamePort + 1}/tcp`]: {},
            [`${opts.gamePort + 2}/udp`]: {}
        },
        Tty: true,
        OpenStdin: true,
        NetworkingConfig: { EndpointsConfig: { [config.dockerNetwork]: {} } },
        HostConfig: {
            Binds: [`${opts.dataPath}:/palworld`],
            PortBindings: proxy.bindings,
            RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
            Memory: opts.plan.memoryBytes,
            NanoCpus: opts.plan.nanoCpus, CpuShares: Math.round((opts.plan.nanoCpus / 10**9) * 1024),
            BlkioWeight: config.dockerBlkioWeight,
            ...GAME_SECURITY_CONFIG
        },
        Labels: { 'ragenodes.server_id': String(opts.serverId), 'ragenodes.game': 'palworld', ...proxy.labels }
    });

    await container.start();
    return container;
}

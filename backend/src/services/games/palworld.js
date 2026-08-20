import { getNodeConnection, runRemoteCommand, localDocker, GAME_SECURITY_CONFIG, cloneFromMasterTemplate , sh } from '../dockerUtils.js';
import { config } from '../../config.js';

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

    const container = await docker.createContainer({
        Image: config.palworldBaseImage,
        name: opts.containerName,
        Env: [
            `SERVER_NAME=${opts.serverName}`,
            `PLAYERS=${opts.maxPlayers || 32}`,
            `ADMIN_PASSWORD=${opts.adminPassword || 'ragenodes_admin'}`,
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
            PortBindings: {
                '8211/udp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort) }],
                [`${opts.gamePort + 1}/tcp`]: [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort + 1) }],
                [`${opts.gamePort + 2}/udp`]: [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort + 2) }]
            },
            RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
            Memory: opts.plan.memoryBytes,
            NanoCpus: opts.plan.nanoCpus, CpuShares: Math.round((opts.plan.nanoCpus / 10**9) * 1024),
            BlkioWeight: 100,
        }
    });

    await container.start();
    return container;
}

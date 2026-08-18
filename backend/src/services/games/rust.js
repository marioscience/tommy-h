import { getNodeConnection, runRemoteCommand, localDocker, GAME_SECURITY_CONFIG, cloneFromMasterTemplate , sh } from '../dockerUtils.js';
import { config } from '../../config.js';

export async function createRustContainer(opts) {
    const docker = await getNodeConnection(opts.nodeId || 0);
    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${opts.dataPath} && chown -R 1000:1000 ${opts.dataPath}`);
    await cloneFromMasterTemplate('rust', opts.dataPath, opts.nodeId);

    try {
        await docker.getImage(config.rustBaseImage).inspect();
    } catch (e) {
        console.log(`🚚 [Docker] Descargando imagen ${config.rustBaseImage}...`);
        const stream = await docker.pull(config.rustBaseImage);
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
        });
    }

    const container = await docker.createContainer({
        Image: config.rustBaseImage,
        name: opts.containerName,
        Env: [
            `RUST_SERVER_NAME=${opts.serverName}`,
            'RUST_SERVER_STARTUP_ARGUMENTS=-batchmode +server.port 28015 +server.queryport 28017 +server.identity "ragenodes"',
            'RUST_OXIDE=1', // Habilitar soporte para plugins por defecto
            'RUST_UPDATE_CHECKING=1',
            'RUST_UPDATE_BRANCH=public'
        ],
        ExposedPorts: { '28015/udp': {}, '28016/tcp': {}, '28017/udp': {} },
        Tty: true,
        OpenStdin: true,
        NetworkingConfig: { EndpointsConfig: { [config.dockerNetwork]: {} } },
        HostConfig: {
            Binds: [`${opts.dataPath}:/steamcmd/rust`],
            PortBindings: {
                '28015/udp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort) }],
                '28016/tcp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort + 1) }], // RCON
                '28017/udp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort + 2) }]  // Query
            },
            RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
            Memory: opts.plan.memoryBytes,
            NanoCpus: opts.plan.nanoCpus, CpuShares: Math.round((opts.plan.nanoCpus / 10**9) * 1024),
            BlkioWeight: config.dockerBlkioWeight,
            ...GAME_SECURITY_CONFIG
        }
    });

    await container.start();
    return container;
}

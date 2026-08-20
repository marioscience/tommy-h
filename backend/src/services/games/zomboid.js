import { getNodeConnection, runRemoteCommand, localDocker, GAME_SECURITY_CONFIG, cloneFromMasterTemplate , sh } from '../dockerUtils.js';
import { config } from '../../config.js';

export async function createProjectZomboidContainer(opts) {
    const docker = await getNodeConnection(opts.nodeId || 0);
    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${opts.dataPath} && chown -R 1000:1000 ${opts.dataPath}`);
    await cloneFromMasterTemplate('zomboid', opts.dataPath, opts.nodeId);

    try { await docker.getImage('renegademaster/zomboid-dedicated-server').inspect(); }
    catch (e) {
        console.log(`🚚 [Docker] Descargando imagen ${'renegademaster/zomboid-dedicated-server'}...`);
        const stream = await docker.pull('renegademaster/zomboid-dedicated-server');
        await new Promise((resolve, reject) => { docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res)); });
    }

    const container = await docker.createContainer({
        Image: 'renegademaster/zomboid-dedicated-server',
        name: opts.containerName,
        Env: [
            `SERVER_NAME=${opts.serverName}`,
            'ADMIN_PASSWORD=ragenodes_admin',
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
            PortBindings: {
                '16261/udp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort) }],
                '16262/udp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort + 1) }],
            },
            RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
            Memory: opts.plan.memoryBytes,
            NanoCpus: opts.plan.nanoCpus, CpuShares: Math.round((opts.plan.nanoCpus / 10**9) * 1024),
            BlkioWeight: 100,
            ...GAME_SECURITY_CONFIG
        }
    });

    await container.start();
    return container;
}

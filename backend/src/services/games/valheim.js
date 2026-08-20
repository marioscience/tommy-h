import { getNodeConnection, runRemoteCommand, localDocker, GAME_SECURITY_CONFIG, cloneFromMasterTemplate , sh } from '../dockerUtils.js';
import { config } from '../../config.js';

export async function createValheimContainer(opts) {
    const docker = await getNodeConnection(opts.nodeId || 0);
    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${opts.dataPath} && chown -R 1000:1000 ${opts.dataPath}`);
    await cloneFromMasterTemplate('valheim', opts.dataPath, opts.nodeId);

    try { await docker.getImage(config.valheimBaseImage).inspect(); }
    catch (e) {
        console.log(`🚚 [Docker] Descargando imagen ${config.valheimBaseImage}...`);
        const stream = await docker.pull(config.valheimBaseImage);
        await new Promise((resolve, reject) => { docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res)); });
    }

    const container = await docker.createContainer({
        Image: config.valheimBaseImage,
        name: opts.containerName,
        Env: [
            `SERVER_NAME=${opts.serverName}`,
            `SERVER_PASS=vikingos`,
            `WORLD_NAME=RageNodesWorld`,
            `SERVER_PUBLIC=1`,
            `UPDATE_CRON=0 4 * * *`,
            `BACKUPS=false`,
            'TZ=UTC'
        ],
        ExposedPorts: { '2456/udp': {}, '2457/udp': {}, '2458/udp': {} },
        Tty: true,
        OpenStdin: true,
        NetworkingConfig: { EndpointsConfig: { [config.dockerNetwork]: {} } },
        HostConfig: {
            Binds: [`${opts.dataPath}:/config`, `${opts.dataPath}/data:/opt/valheim`],
            PortBindings: {
                '2456/udp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort) }],
                '2457/udp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort + 1) }],
                '2458/udp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort + 2) }],
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

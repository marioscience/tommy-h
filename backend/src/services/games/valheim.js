import { getNodeConnection, runRemoteCommand, GAME_SECURITY_CONFIG, cloneFromMasterTemplate, deriveServicePassword, deriveServiceIdentifier, sh } from '../dockerUtils.js';
import { config } from '../../config.js';
import { saveValheimConfig } from '../valheimService.js';
import { prepareGameProxyBindings } from '../gameProxyPolicy.js';

export async function createValheimContainer(opts) {
    const docker = await getNodeConnection(opts.nodeId || 0);
    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${opts.dataPath} && chown -R 1000:1000 ${opts.dataPath}`);
    await cloneFromMasterTemplate('valheim', opts.dataPath, opts.nodeId);
    const serverPassword = opts.serverPassword || deriveServicePassword('valheim-server', opts.serverId || opts.containerName).slice(0, 16);
    const worldName = deriveServiceIdentifier('world', opts.serverId || opts.containerName, 24);
    await saveValheimConfig(opts.dataPath, {
        SERVER_NAME: opts.serverName,
        SERVER_PASS: serverPassword,
        WORLD_NAME: worldName,
        SERVER_PUBLIC: '1',
        SERVER_ARGS: '-crossplay',
        UPDATE_CRON: '0 4 * * *',
        BACKUPS: 'false'
    });

    try { await docker.getImage(config.valheimBaseImage).inspect(); }
    catch (e) {
        console.log(`🚚 [Docker] Descargando imagen ${config.valheimBaseImage}...`);
        const stream = await docker.pull(config.valheimBaseImage);
        await new Promise((resolve, reject) => { docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res)); });
    }

    const proxy = prepareGameProxyBindings({
        '2456/udp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort) }],
        '2457/udp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort + 1) }],
        '2458/udp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort + 2) }]
    }, { enabled: config.oxideGameProxyEnabled, backendOffset: config.gameBackendPortOffset, backendBindIp: config.gameBackendBindIp });
    const container = await docker.createContainer({
        Image: config.valheimBaseImage,
        name: opts.containerName,
        Env: [
            `SERVER_NAME=${opts.serverName}`,
            `SERVER_PASS=${serverPassword}`,
            `WORLD_NAME=${worldName}`,
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
            PortBindings: proxy.bindings,
            RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
            Memory: opts.plan.memoryBytes,
            NanoCpus: opts.plan.nanoCpus, CpuShares: Math.round((opts.plan.nanoCpus / 10**9) * 1024),
            BlkioWeight: config.dockerBlkioWeight,
            ...GAME_SECURITY_CONFIG
        },
        Labels: { 'ragenodes.server_id': String(opts.serverId), 'ragenodes.game': 'valheim', ...proxy.labels }
    });

    await container.start();
    return container;
}

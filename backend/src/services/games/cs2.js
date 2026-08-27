import { getNodeConnection, runRemoteCommand, localDocker, GAME_SECURITY_CONFIG, cloneFromMasterTemplate, deriveServicePassword, sh } from '../dockerUtils.js';
import { config } from '../../config.js';

export async function createCS2Container(opts) {
    const docker = await getNodeConnection(opts.nodeId || 0);
    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${opts.dataPath} && chown -R 1000:1000 ${opts.dataPath}`);
    await cloneFromMasterTemplate('cs2', opts.dataPath, opts.nodeId);
    
    try {
        await runRemoteCommand(opts.nodeId || 0, sh`chown -R 1000:1000 ${opts.dataPath}`);
    } catch (e) {
        console.warn(`⚠️ [CS2] No se pudo cambiar el owner: ${e.message}`);
    }

    try {
        await docker.getImage(config.cs2BaseImage).inspect();
    } catch (e) {
        console.log(`🚚 [Docker] Descargando imagen ${config.cs2BaseImage}...`);
        const stream = await docker.pull(config.cs2BaseImage);
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
        });
    }

    const container = await docker.createContainer({
        Image: config.cs2BaseImage,
        name: opts.containerName,
        Env: [
            `SRCDS_HOSTNAME=RageNodes | ${opts.serverName}`,
            'SRCDS_MAP=de_dust2',
            'SRCDS_GAME_TYPE=0',
            'SRCDS_GAME_MODE=1',
            'SRCDS_MAXPLAYERS=12',
            'SRCDS_TICKRATE=64', // Perfil estable y accesible para servidores nuevos
            `SRCDS_RCON_PW=${deriveServicePassword('cs2-rcon', opts.serverId || opts.containerName)}`,
        ],
        ExposedPorts: { '27015/tcp': {}, '27015/udp': {} },
        Tty: true,
        OpenStdin: true,
        NetworkingConfig: { EndpointsConfig: { [config.dockerNetwork]: {} } },
        HostConfig: {
            Binds: [`${opts.dataPath}:/home/steam/cs2-dedicated`],
            PortBindings: {
                '27015/tcp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort) }],
                '27015/udp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort) }]
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

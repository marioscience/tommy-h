import { getNodeConnection, runRemoteCommand, GAME_SECURITY_CONFIG, cloneFromMasterTemplate, deriveServicePassword, sh } from '../dockerUtils.js';
import { config } from '../../config.js';
import { prepareGameProxyBindings } from '../gameProxyPolicy.js';

async function normalizeCS2DataOwnership(docker, image, dataPath, serverId) {
    const helperName = `ragenodes-cs2-permissions-${String(serverId || Date.now()).slice(0, 12)}`;
    let helper;
    try {
        helper = await docker.createContainer({
            Image: image,
            name: helperName,
            User: '0:0',
            Entrypoint: ['/bin/sh', '-c'],
            Cmd: ['chown -R 1000:1000 /target'],
            HostConfig: {
                Binds: [`${dataPath}:/target`],
                NetworkMode: 'none',
                ReadonlyRootfs: true,
                CapDrop: ['ALL'],
                CapAdd: ['CHOWN', 'FOWNER', 'DAC_OVERRIDE'],
                SecurityOpt: ['no-new-privileges:true']
            }
        });
        await helper.start();
        const result = await helper.wait();
        if (Number(result?.StatusCode) !== 0) {
            throw new Error(`el normalizador termino con codigo ${result?.StatusCode}`);
        }
    } finally {
        if (helper) await helper.remove({ force: true }).catch(() => {});
    }
}

export async function createCS2Container(opts) {
    const docker = await getNodeConnection(opts.nodeId || 0);
    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${opts.dataPath} && chown -R 1000:1000 ${opts.dataPath}`);
    await cloneFromMasterTemplate('cs2', opts.dataPath, opts.nodeId);
    
    try {
        await docker.getImage(config.cs2BaseImage).inspect();
    } catch (e) {
        console.log(`🚚 [Docker] Descargando imagen ${config.cs2BaseImage}...`);
        const stream = await docker.pull(config.cs2BaseImage);
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
        });
    }

    // La traduccion de UID de Docker rootless convierte un chown del host a
    // 1000:1000 en root dentro del contenedor. Ejecutarlo dentro del namespace
    // del daemon produce el propietario correcto sin depender del subuid local.
    await normalizeCS2DataOwnership(docker, config.cs2BaseImage, opts.dataPath, opts.serverId);

    const proxy = prepareGameProxyBindings({
        '27015/tcp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort) }],
        '27015/udp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort) }]
    }, { enabled: config.oxideGameProxyEnabled, backendOffset: config.gameBackendPortOffset, backendBindIp: config.gameBackendBindIp });
    const container = await docker.createContainer({
        Image: config.cs2BaseImage,
        name: opts.containerName,
        Env: [
            `CS2_SERVERNAME=RageNodes | ${opts.serverName}`,
            'CS2_PORT=27015',
            'CS2_STARTMAP=de_dust2',
            'CS2_MAPGROUP=mg_active',
            'CS2_GAMETYPE=0',
            'CS2_GAMEMODE=1',
            'CS2_MAXPLAYERS=12',
            `CS2_RCONPW=${deriveServicePassword('cs2-rcon', opts.serverId || opts.containerName)}`,
        ],
        ExposedPorts: { '27015/tcp': {}, '27015/udp': {} },
        Tty: true,
        OpenStdin: true,
        NetworkingConfig: { EndpointsConfig: { [config.dockerNetwork]: {} } },
        HostConfig: {
            Binds: [`${opts.dataPath}:/home/steam/cs2-dedicated`],
            PortBindings: proxy.bindings,
            RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
            Memory: opts.plan.memoryBytes,
            NanoCpus: opts.plan.nanoCpus, CpuShares: Math.round((opts.plan.nanoCpus / 10**9) * 1024),
            BlkioWeight: config.dockerBlkioWeight,
            ...GAME_SECURITY_CONFIG
        },
        Labels: { 'ragenodes.server_id': String(opts.serverId), 'ragenodes.game': 'cs2', ...proxy.labels }
    });

    await container.start();
    return container;
}

import { getNodeConnection, runRemoteCommand, commandStdout, GAME_SECURITY_CONFIG, cloneFromMasterTemplate, deriveServicePassword, sh } from '../dockerUtils.js';
import { config } from '../../config.js';
import { saveSDTDConfig } from '../sdtdService.js';
import { prepareGameProxyBindings } from '../gameProxyPolicy.js';

export function buildSDTDInstallationCheck(dataPath) {
    const requiredFiles = [
        `${dataPath}/7dtd/7DaysToDieServer.x86_64`,
        `${dataPath}/7dtd/UnityPlayer.so`,
        `${dataPath}/7dtd/7DaysToDieServer_Data/globalgamemanagers`
    ];
    return sh`if [ -x ${requiredFiles[0]} ] && [ -r ${requiredFiles[1]} ] && [ -r ${requiredFiles[2]} ]; then printf yes; else printf no; fi`;
}

async function setOwnership(docker, image, dataPath, serverId, ownership) {
    const helperName = `ragenodes-sdtd-permissions-${String(serverId || Date.now()).slice(0, 12)}-${Math.floor(Math.random()*10000)}`;
    let helper;
    try {
        helper = await docker.createContainer({
            Image: image,
            name: helperName,
            User: '0:0',
            Entrypoint: ['/bin/sh', '-c'],
            Cmd: [`chown -R ${ownership} /target`],
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

export async function createSDTDContainer(containerName, serverId, gamePort, plan, dataPath, nodeId = 0) {
    const docker = await getNodeConnection(nodeId);
    // Keep the final path absent while the shared template is prepared. Creating
    // it here allows background observers to populate it and breaks the atomic
    // rename performed by cloneFromMasterTemplate after a long cache seed.
    await cloneFromMasterTemplate('sdtd', dataPath, nodeId);
    const installed = commandStdout(await runRemoteCommand(
        nodeId,
        buildSDTDInstallationCheck(dataPath)
    )).trim() === 'yes';
    if (!installed) {
        console.warn('[7DTD] Instalacion ausente o incompleta; SteamCMD la validara antes del primer arranque.');
    }

    try {
        await docker.getImage(config.sdtdBaseImage).inspect();
    } catch (e) {
        console.log(`🚚 [Docker] Descargando imagen ${config.sdtdBaseImage}...`);
        const stream = await docker.pull(config.sdtdBaseImage);
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
        });
    }

    await setOwnership(docker, config.sdtdBaseImage, dataPath, serverId, '0:0');

    const telnetPassword = deriveServicePassword('sdtd-telnet', serverId);
    await saveSDTDConfig(dataPath, {
        ServerPort: String(gamePort),
        TelnetPassword: telnetPassword
    });
    await runRemoteCommand(nodeId, sh`mkdir -p ${dataPath + '/config/Saves/Navezgane/RageNodes'}`);
    
    await setOwnership(docker, config.sdtdBaseImage, dataPath, serverId, '1000:1000');

    const publicBindings = {
        [`${gamePort}/tcp`]: [{ HostIp: '0.0.0.0', HostPort: String(gamePort) }],
        [`${gamePort}/udp`]: [{ HostIp: '0.0.0.0', HostPort: String(gamePort) }],
        [`${gamePort+1}/udp`]: [{ HostIp: '0.0.0.0', HostPort: String(gamePort + 1) }],
        [`${gamePort+2}/udp`]: [{ HostIp: '0.0.0.0', HostPort: String(gamePort + 2) }],
        [`${gamePort+3}/udp`]: [{ HostIp: '0.0.0.0', HostPort: String(gamePort + 3) }]
    };
    const proxy = prepareGameProxyBindings(publicBindings, { enabled: config.oxideGameProxyEnabled, backendOffset: config.gameBackendPortOffset, backendBindIp: config.gameBackendBindIp });
    const container = await docker.createContainer({
        Image: config.sdtdBaseImage,
        name: containerName,
        Env: [
            `SEVEN_DAYS_TO_DIE_SERVER_PORT=${gamePort}`,
            'SEVEN_DAYS_TO_DIE_TELNET_PORT=8081',
            `SEVEN_DAYS_TO_DIE_TELNET_PASSWORD=${telnetPassword}`,
            // Una plantilla ya instalada debe arrancar en segundos y mantener
            // su version. Solo una instancia realmente vacia ejecuta SteamCMD.
            `SEVEN_DAYS_TO_DIE_START_MODE=${installed ? '2' : '0'}`,
            'SEVEN_DAYS_TO_DIE_UPDATE_CHECKING=0',
            'SEVEN_DAYS_TO_DIE_CONFIG_FILE=/app/.local/share/7DaysToDie/serverconfig.xml',
            'TZ=Europe/Madrid'
        ],
        ExposedPorts: {
            [`${gamePort}/tcp`]: {}, [`${gamePort}/udp`]: {},
            [`${gamePort+1}/udp`]: {}, [`${gamePort+2}/udp`]: {},
            [`${gamePort+3}/udp`]: {},
            '8081/tcp': {}
        },
        Tty: true,
        OpenStdin: true,
        NetworkingConfig: { EndpointsConfig: { [config.dockerNetwork]: {} } },
        HostConfig: {
            Binds: [
                `${dataPath}/7dtd:/steamcmd/7dtd`,
                `${dataPath}/config:/app/.local/share/7DaysToDie`
            ],
            PortBindings: proxy.bindings,
            RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
            Memory: plan.memoryBytes,
            NanoCpus: plan.nanoCpus, CpuShares: Math.round((plan.nanoCpus / 10**9) * 1024),
            BlkioWeight: config.dockerBlkioWeight,
            ...GAME_SECURITY_CONFIG
        },
        Labels: { 'ragenodes.server_id': String(serverId), 'ragenodes.game': 'sdtd', ...proxy.labels }
    });

    await container.start();
    return container;
}

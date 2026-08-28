import { getNodeConnection, runRemoteCommand, localDocker, GAME_SECURITY_CONFIG, cloneFromMasterTemplate, deriveServicePassword, sh } from '../dockerUtils.js';
import { config } from '../../config.js';
import { saveSDTDConfig } from '../sdtdService.js';
import { prepareGameProxyBindings } from '../gameProxyPolicy.js';

export async function createSDTDContainer(containerName, serverId, gamePort, plan, dataPath, nodeId = 0) {
    const docker = await getNodeConnection(nodeId);
    await runRemoteCommand(nodeId, sh`mkdir -p ${dataPath}`);
    await cloneFromMasterTemplate('sdtd', dataPath);

    try {
        await docker.getImage(config.sdtdBaseImage).inspect();
    } catch (e) {
        console.log(`🚚 [Docker] Descargando imagen ${config.sdtdBaseImage}...`);
        const stream = await docker.pull(config.sdtdBaseImage);
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
        });
    }

    const telnetPassword = deriveServicePassword('sdtd-telnet', serverId);
    await saveSDTDConfig(dataPath, {
        ServerPort: String(gamePort),
        TelnetPassword: telnetPassword
    });

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
            'SEVEN_DAYS_TO_DIE_UPDATE_CHECKING=1',
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

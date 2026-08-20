import { getNodeConnection, runRemoteCommand, localDocker, GAME_SECURITY_CONFIG, cloneFromMasterTemplate , sh } from '../dockerUtils.js';
import { config } from '../../config.js';
import { saveSDTDConfig } from '../sdtdService.js';

export async function createSDTDContainer(containerName, serverId, gamePort, plan, dataPath, nodeId = 0) {
    const docker = await getNodeConnection(nodeId);
    await runRemoteCommand(nodeId, sh`mkdir -p ${dataPath}`);
    await cloneFromMasterTemplate('sdtd', dataPath);

    try {
        await docker.getImage('didstopia/7dtd-server:latest').inspect();
    } catch (e) {
        console.log(`🚚 [Docker] Descargando imagen ${'didstopia/7dtd-server:latest'}...`);
        const stream = await docker.pull('didstopia/7dtd-server:latest');
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
        });
    }

    await saveSDTDConfig(dataPath, { ServerPort: String(gamePort) });

    const container = await docker.createContainer({
        Image: 'didstopia/7dtd-server:latest',
        name: containerName,
        Env: [
            `SEVEN_DAYS_TO_DIE_SERVER_PORT=${gamePort}`,
            'SEVEN_DAYS_TO_DIE_TELNET_PORT=8081',
            'SEVEN_DAYS_TO_DIE_TELNET_PASSWORD=ragenodes_admin',
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
            PortBindings: {
                [`${gamePort}/tcp`]: [{ HostIp: '0.0.0.0', HostPort: String(gamePort) }],
                [`${gamePort}/udp`]: [{ HostIp: '0.0.0.0', HostPort: String(gamePort) }],
                [`${gamePort+1}/udp`]: [{ HostIp: '0.0.0.0', HostPort: String(gamePort + 1) }],
                [`${gamePort+2}/udp`]: [{ HostIp: '0.0.0.0', HostPort: String(gamePort + 2) }],
                [`${gamePort+3}/udp`]: [{ HostIp: '0.0.0.0', HostPort: String(gamePort + 3) }]
            },
            RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
            Memory: plan.memoryBytes,
            NanoCpus: plan.nanoCpus, CpuShares: Math.round((plan.nanoCpus / 10**9) * 1024),
            BlkioWeight: 100,
            ...GAME_SECURITY_CONFIG
        }
    });

    await container.start();
    return container;
}

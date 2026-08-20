import { getNodeConnection, runRemoteCommand, localDocker, GAME_SECURITY_CONFIG, sh } from '../dockerUtils.js';
import { config } from '../../config.js';

export async function createDatabaseContainer(opts) {
    const docker = await getNodeConnection(opts.nodeId || 0);
    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${opts.dataPath} && chown -R 999:999 ${opts.dataPath}`);

    try {
        await docker.getImage(config.databaseBaseImage).inspect();
    } catch (e) {
        console.log(`[Docker] Descargando imagen ${config.databaseBaseImage}...`);
        const stream = await docker.pull(config.databaseBaseImage);
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
        });
    }

    const container = await docker.createContainer({
        Image: config.databaseBaseImage,
        name: opts.containerName,
        Env: [
            `MYSQL_ROOT_PASSWORD=db_${opts.containerName}_root`,
            `MYSQL_DATABASE=db_${opts.containerName}`,
            `MYSQL_USER=user_${opts.containerName}`,
            `MYSQL_PASSWORD=pass_${opts.containerName}_!2026`
        ],
        ExposedPorts: { '3306/tcp': {} },
        Tty: true,
        OpenStdin: true,
        NetworkingConfig: { EndpointsConfig: { [config.dockerNetwork]: {} } },
        HostConfig: {
            Binds: [`${opts.dataPath}:/var/lib/mysql`],
            PortBindings: {
                '3306/tcp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort) }]
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

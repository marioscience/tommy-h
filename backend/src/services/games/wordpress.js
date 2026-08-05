import { getNodeConnection, runRemoteCommand, localDocker, GAME_SECURITY_CONFIG, sh } from '../dockerUtils.js';
import { config } from '../../config.js';

export async function createWordPressContainer(opts) {
    const docker = await getNodeConnection(opts.nodeId || 0);
    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${opts.dataPath}/wp-content && chown -R 33:33 ${opts.dataPath}`);

    try {
        await docker.getImage(config.wordpressBaseImage).inspect();
    } catch (e) {
        console.log(`[Docker] Descargando imagen ${config.wordpressBaseImage}...`);
        const stream = await docker.pull(config.wordpressBaseImage);
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
        });
    }

    const container = await docker.createContainer({
        Image: config.wordpressBaseImage,
        name: opts.containerName,
        Env: [
            `WORDPRESS_DB_HOST=172.17.0.1:3306`, // Default MySQL if needed
            `WORDPRESS_DB_USER=root`,
            `WORDPRESS_DB_PASSWORD=ragenodes_db`,
            `WORDPRESS_DB_NAME=wp_${opts.containerName}`
        ],
        ExposedPorts: { '80/tcp': {} },
        Tty: true,
        OpenStdin: true,
        NetworkingConfig: { EndpointsConfig: { [config.dockerNetwork]: {} } },
        HostConfig: {
            Binds: [`${opts.dataPath}:/var/www/html`], // Persistent storage
            PortBindings: {
                '80/tcp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort) }] // Dynamic HTTP port
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

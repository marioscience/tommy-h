import { getNodeConnection, runRemoteCommand, normalizeBindOwnership, sh } from '../dockerUtils.js';
import { deriveServiceIdentifier, deriveServicePassword, GAME_SECURITY_CONFIG } from '../gameRuntimePolicy.js';
import { config } from '../../config.js';

export async function createWordPressContainer(opts) {
    const docker = await getNodeConnection(opts.nodeId || 0);
    const htmlPath = `${opts.dataPath}/html`;
    const databasePath = `${opts.dataPath}/database`;
    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${htmlPath}/wp-content ${databasePath}`);

    const credentialId = opts.serverId || opts.containerName;
    const dbName = deriveServiceIdentifier('wpdb', credentialId, 24).replaceAll('-', '_');
    const dbUser = deriveServiceIdentifier('wpuser', credentialId, 24).replaceAll('-', '_');
    const dbPassword = deriveServicePassword('wordpress-database', credentialId);

    for (const image of [config.wordpressBaseImage, config.databaseBaseImage]) {
        try {
            await docker.getImage(image).inspect();
        } catch (e) {
            console.log(`[Docker] Descargando imagen ${image}...`);
            const stream = await docker.pull(image);
            await new Promise((resolve, reject) => {
                docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
            });
        }
    }

    await normalizeBindOwnership(docker, config.wordpressBaseImage, htmlPath, '33:33', 'wordpress');
    await normalizeBindOwnership(docker, config.databaseBaseImage, databasePath, '999:999', 'wordpress-db');

    const dbContainerName = `${opts.containerName}-db`;
    let dbContainer = docker.getContainer(dbContainerName);
    try {
        const state = await dbContainer.inspect();
        if (!state.State.Running) await dbContainer.start();
    } catch (error) {
        if (error?.statusCode !== 404) throw error;
        dbContainer = await docker.createContainer({
            Image: config.databaseBaseImage,
            name: dbContainerName,
            Env: [
                `MYSQL_ROOT_PASSWORD=${deriveServicePassword('wordpress-root', credentialId)}`,
                `MYSQL_DATABASE=${dbName}`,
                `MYSQL_USER=${dbUser}`,
                `MYSQL_PASSWORD=${dbPassword}`
            ],
            NetworkingConfig: { EndpointsConfig: { [config.dockerNetwork]: {} } },
            HostConfig: {
                Binds: [`${databasePath}:/var/lib/mysql`],
                RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
                Memory: opts.plan.memoryBytes,
                NanoCpus: opts.plan.nanoCpus,
                CpuShares: Math.round((opts.plan.nanoCpus / 10**9) * 1024),
                BlkioWeight: config.dockerBlkioWeight,
                ...GAME_SECURITY_CONFIG
            },
            Labels: { 'ragenodes.server_id': String(opts.serverId), 'ragenodes.game': 'wordpress-database' }
        });
        await dbContainer.start();
    }

    const container = await docker.createContainer({
        Image: config.wordpressBaseImage,
        name: opts.containerName,
        Env: [
            `WORDPRESS_DB_HOST=${dbContainerName}:3306`,
            `WORDPRESS_DB_USER=${dbUser}`,
            `WORDPRESS_DB_PASSWORD=${dbPassword}`,
            `WORDPRESS_DB_NAME=${dbName}`,
            `WORDPRESS_CONFIG_EXTRA=if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] == 'https') { $_SERVER['HTTPS'] = 'on'; }`
        ],
        ExposedPorts: { '80/tcp': {} },
        NetworkingConfig: { EndpointsConfig: { [config.dockerNetwork]: {} } },
        HostConfig: {
            Binds: [`${htmlPath}:/var/www/html`],
            PortBindings: {
                '80/tcp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort) }]
            },
            RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
            Memory: opts.plan.memoryBytes,
            NanoCpus: opts.plan.nanoCpus, CpuShares: Math.round((opts.plan.nanoCpus / 10**9) * 1024),
            BlkioWeight: config.dockerBlkioWeight,
            ...GAME_SECURITY_CONFIG,
            CapAdd: ["CHOWN", "SETUID", "SETGID", "NET_BIND_SERVICE", "KILL", "DAC_OVERRIDE", "DAC_READ_SEARCH", "FOWNER", "FSETID"]
        }
    });

    await container.start();
    return container;
}

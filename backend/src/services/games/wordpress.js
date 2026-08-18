import { getNodeConnection, runRemoteCommand, localDocker, GAME_SECURITY_CONFIG, sh } from '../dockerUtils.js';
import { config } from '../../config.js';
import mysql from 'mysql2/promise';

export async function createWordPressContainer(opts) {
    const docker = await getNodeConnection(opts.nodeId || 0);
    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${opts.dataPath}/wp-content && chown -R 33:33 ${opts.dataPath}`);

    try {
        const dbConn = await mysql.createConnection({ host: 'mariadb', user: 'root', password: config.centralDbPass });
        await dbConn.query(`CREATE DATABASE IF NOT EXISTS \`wp_${opts.containerName}\`;`);
        await dbConn.end();
    } catch (dbErr) {
        console.error('[WordPress] Fallo al crear la base de datos:', dbErr);
    }

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
            `WORDPRESS_DB_HOST=mariadb`,
            `WORDPRESS_DB_USER=root`,
            `WORDPRESS_DB_PASSWORD=${config.centralDbPass}`,
            `WORDPRESS_DB_NAME=wp_${opts.containerName}`,
            `WORDPRESS_CONFIG_EXTRA=if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] == 'https') { $_SERVER['HTTPS'] = 'on'; }`
        ],
        ExposedPorts: { '80/tcp': {} },
        Tty: true,
        OpenStdin: true,
        NetworkingConfig: { EndpointsConfig: { [config.dockerNetwork]: {} } },
        HostConfig: {
            Binds: [`${opts.dataPath}:/var/www/html`],
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

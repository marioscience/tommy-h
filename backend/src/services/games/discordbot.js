import { getNodeConnection, runRemoteCommand, localDocker, GAME_SECURITY_CONFIG, sh } from '../dockerUtils.js';
import { config } from '../../config.js';

export async function createDiscordBotContainer(opts) {
    const docker = await getNodeConnection(opts.nodeId || 0);
    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${opts.dataPath} && chown -R 1000:1000 ${opts.dataPath}`);

    // If the data path is empty, we could populate it with a default discord bot package.json
    // For now we assume the user uploads their bot via File Manager

    try {
        await docker.getImage(config.discordBotBaseImage).inspect();
    } catch (e) {
        console.log(`[Docker] Descargando imagen ${config.discordBotBaseImage}...`);
        const stream = await docker.pull(config.discordBotBaseImage);
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
        });
    }

    const container = await docker.createContainer({
        Image: config.discordBotBaseImage,
        name: opts.containerName,
        Env: [
            `APP_NAME=${opts.serverName}`,
            'DISCORD_TOKEN='
        ],
        WorkingDir: '/app',
        Cmd: ['sh', '-c', 'if [ -f package.json ]; then npm install --omit=dev && npm start; elif [ -f main.py ]; then pip install -r requirements.txt && python main.py; else echo "No se encontró package.json ni main.py. Esperando..."; sleep infinity; fi'],
        Tty: true,
        OpenStdin: true,
        NetworkingConfig: { EndpointsConfig: { [config.dockerNetwork]: {} } },
        HostConfig: {
            Binds: [`${opts.dataPath}:/app`],
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

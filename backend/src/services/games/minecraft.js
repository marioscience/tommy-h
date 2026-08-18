import { getNodeConnection, runRemoteCommand, localDocker, GAME_SECURITY_CONFIG , sh } from '../dockerUtils.js';
import { config } from '../../config.js';

const MINECRAFT_IMAGES = {
    java11: 'itzg/minecraft-server:java11@sha256:b71159ed67e389fac6cbdc2e7205167e210e9012858a9a47cd1d64cd8de28241',
    java17: 'itzg/minecraft-server:java17@sha256:032c6ac2c1a418bde85e19a54222fc1c3220eacc62226e08586cc4d5b7b0c676',
    java21: 'itzg/minecraft-server:java21@sha256:2849cd16063903439cd34c6eaddbcecc8914367ac9334c9757f6a7ea5007273c',
    java25: config.minecraftBaseImage
};

export async function createMinecraftContainer(opts) {
    const docker = await getNodeConnection(opts.nodeId || 0);
    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${opts.dataPath} && chown -R 1000:1000 ${opts.dataPath}`);

    // Seleccionar la versión correcta de Java según la versión de Minecraft
    let imageTag = 'java17'; // Por defecto para 1.17 - 1.20.4
    let version = opts.mcVersion || 'LATEST';

    if (version === 'LATEST') {
        try {
            const { stdout } = await runRemoteCommand(opts.nodeId || 0, sh`ls -1 ${opts.dataPath} || true`);
            const match = stdout.match(/(?:paper|purpur|spigot|forge|fabric|minecraft_server\.?)-?(\d+\.\d+(\.\d+)?)/i);
            if (match && match[1]) {
                version = match[1];
                console.log(`[Minecraft] Detectada versión instalada ${version} en ${opts.dataPath}. Fijando versión para evitar auto-update.`);
            }
        } catch (e) {
            console.error(`[Minecraft] Error detectando versión:`, e.message);
        }
    }

    if (version.startsWith('1.8') || version.startsWith('1.12') || version.startsWith('1.16')) imageTag = 'java11';
    if (version.startsWith('1.20.5') || version.startsWith('1.20.6') || version.startsWith('1.21') || version.startsWith('1.22') || version.startsWith('1.23') || version.startsWith('1.24') || version.startsWith('1.25')) imageTag = 'java21';
    if (version.startsWith('26') || version.startsWith('1.26') || version === 'LATEST') imageTag = 'java25';
    const targetImage = MINECRAFT_IMAGES[imageTag];

    // 📥 Asegurar que la imagen existe (Auto-pull)
    try {
        await docker.getImage(targetImage).inspect();
    } catch (e) {
        console.log(`🚚 [Docker] Descargando imagen ${targetImage}...`);
        const stream = await docker.pull(targetImage);
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
        });
        console.log(`✅ [Docker] Imagen ${targetImage} descargada.`);
    }

    // Calcular memoria para JVM (85% del límite del plan)
    const memoryMb = Math.floor(opts.plan.memoryBytes / 1024 / 1024 * 0.85);
    const jvmMemory = `${memoryMb}M`;

    const container = await docker.createContainer({
        Image: targetImage,
        name: opts.containerName,
        Env: [
            'EULA=TRUE',
            `VERSION=${version}`,
            `TYPE=${opts.mcType || 'PAPER'}`,
            `DIFFICULTY=${opts.difficulty || 'normal'}`,
            `MAX_PLAYERS=${opts.maxPlayers || 20}`,
            `SERVER_NAME=${opts.serverName}`,
            `MEMORY=${jvmMemory}`,
            `INIT_MEMORY=${jvmMemory}`,
            `MAX_MEMORY=${jvmMemory}`,
            'USE_AIKAR_FLAGS=true',
            'ENABLE_RCON=false',
            'OVERRIDE_SERVER_PROPERTIES=false',
            'ONLINE_MODE=TRUE',
            'ENFORCE_SECURE_PROFILE=TRUE'
        ],
        ExposedPorts: { '25565/tcp': {}, '25565/udp': {} },
        Tty: true,
        OpenStdin: true,
        NetworkingConfig: {
            EndpointsConfig: { [config.dockerNetwork]: {} }
        },
        HostConfig: {
            Binds: [`${opts.dataPath}:/data`],
            PortBindings: {
                '25565/tcp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort) }],
                '25565/udp': [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort) }],
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

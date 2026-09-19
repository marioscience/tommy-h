import { getNodeConnection, runRemoteCommand, cloneFromMasterTemplate, sh } from '../dockerUtils.js';
import { GAME_SECURITY_CONFIG, deriveServicePassword } from '../gameRuntimePolicy.js';
import { prepareArkData } from './arkData.js';
import { config } from '../../config.js';
import { prepareGameProxyBindings } from '../gameProxyPolicy.js';

function sanitizeArkLaunchValue(value, fallback = '') {
    return String(value || fallback)
        .trim()
        .replace(/[^A-Za-z0-9_.:-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || fallback;
}

const ARK_SUPPORTED_MAPS = new Set([
    'TheIsland_WP',
    'ScorchedEarth_WP',
    'TheCenter_WP',
    'Aberration_WP',
    'Extinction_WP',
    'Astraeos_WP'
]);

const ARK_MAP_ALIASES = {
    theisland: 'TheIsland_WP',
    the_island: 'TheIsland_WP',
    theisland_wp: 'TheIsland_WP',
    island: 'TheIsland_WP',
    scorchedearth: 'ScorchedEarth_WP',
    scorched_earth: 'ScorchedEarth_WP',
    scorchedearth_wp: 'ScorchedEarth_WP',
    thecenter: 'TheCenter_WP',
    the_center: 'TheCenter_WP',
    thecenter_wp: 'TheCenter_WP',
    aberration: 'Aberration_WP',
    aberration_wp: 'Aberration_WP',
    extinction: 'Extinction_WP',
    extinction_wp: 'Extinction_WP',
    astraeos: 'Astraeos_WP',
    astraeos_wp: 'Astraeos_WP'
};

const ARK_CAPABILITIES = [
    'CHOWN',
    'SETUID',
    'SETGID',
    'KILL',
    'DAC_OVERRIDE'
];

export function buildARKHostConfig(opts, clusterBinds = [], portBindings = {}) {
    const hostConfig = {
        Binds: [`${opts.dataPath}:/home/steam/Steam/steamapps`, ...clusterBinds],
        PortBindings: portBindings,
        RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
        Memory: opts.plan.memoryBytes,
        NanoCpus: opts.plan.nanoCpus,
        CpuShares: Math.round((opts.plan.nanoCpus / 10**9) * 1024),
        ShmSize: 1024 * 1024 * 1024,
        ...GAME_SECURITY_CONFIG,
        // Proton/Wine necesita preparar su prefix con cambios de identidad.
        // Esta excepcion se limita a ARK; el resto de servicios conserva NNP.
        SecurityOpt: [],
        CapAdd: ARK_CAPABILITIES,
        PidsLimit: 2048,
        Init: true
    };

    // Docker Desktop/WSL can expose a cgroup v2 hierarchy without io.weight.
    // Only request block-I/O weighting when the runtime explicitly enables it.
    if (config.dockerBlkioWeight && Number(config.dockerBlkioWeight) > 0) {
        hostConfig.BlkioWeight = Number(config.dockerBlkioWeight);
    }

    return hostConfig;
}

function normalizeArkMapName(value) {
    const raw = sanitizeArkLaunchValue(value, 'TheIsland_WP');
    if (ARK_SUPPORTED_MAPS.has(raw)) return raw;
    const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const mapped = ARK_MAP_ALIASES[key];
    if (mapped) return mapped;
    console.warn('[ARK] Mapa no soportado o no instalado (' + raw + '). Usando TheIsland_WP.');
    return 'TheIsland_WP';
}

export async function createARKContainer(opts) {
    const docker = await getNodeConnection(opts.nodeId || 0);

    try { await docker.getImage(config.arkBaseImage).inspect(); }
    catch (e) {
        console.log(`🚚 [Docker] Descargando imagen ${config.arkBaseImage}...`);
        const stream = await docker.pull(config.arkBaseImage);
        await new Promise((resolve, reject) => { docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res)); });
    }

    const targetNodeId = opts.nodeId || 0;
    // The node user and rootless Docker share ownership of this directory.
    // Never chmod an existing instance root: on mapped/rootless filesystems
    // that operation is forbidden and would prevent otherwise safe restarts.
    await runRemoteCommand(targetNodeId, sh`mkdir -p ${opts.dataPath}`);
    // Reuse the shared template cache used by the other game families. When
    // templates live on NFS and instances on local Btrfs, this pays the NFS
    // copy once and then creates each server with an atomic local reflink.
    const clonedFromMaster = await cloneFromMasterTemplate('ark', opts.dataPath, targetNodeId, {
        refreshExisting: true,
        preservePaths: [
            'common/ARK Survival Ascended Dedicated Server/ShooterGame/Saved'
        ]
    });
    await prepareArkData({ docker, image: config.arkBaseImage,
        dataRoot: config.instanceDataRoot, dataPath: opts.dataPath });

    const clusterBinds = [];
    if (opts.clusterId) {
        const clusterDir = `/var/lib/ragenodes/clusters/${opts.clusterId}`;
        await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${clusterDir}`).catch(() => {});
        try { await runRemoteCommand(opts.nodeId || 0, sh`chown -R 1000:1000 ${clusterDir}`); } catch (e) {}
        clusterBinds.push(`${clusterDir}:/home/steam/Steam/steamapps/common/ARK Survival Ascended Dedicated Server/ShooterGame/Saved/clusters/${opts.clusterId}`);
    }

    let mapName = 'TheIsland_WP';
    let sessionName = opts.serverName;
    const generatedAdminPassword = deriveServicePassword('ark-admin', opts.serverId || opts.containerName);
    let adminPassword = generatedAdminPassword;
    let serverPassword = '';

    try {
        const { getARKConfig } = await import('../arkService.js');
        const arkConfig = await getARKConfig(opts.dataPath);
        if (arkConfig) {
            mapName = arkConfig.CustomMapName || arkConfig.MapName || 'TheIsland_WP';
            sessionName = sanitizeArkLaunchValue(arkConfig.SessionName || opts.serverName, 'ARK_Server');
            const configuredPassword = arkConfig.ServerAdminPassword;
            adminPassword = configuredPassword && configuredPassword !== 'ragenodes_admin'
                ? sanitizeArkLaunchValue(configuredPassword, generatedAdminPassword)
                : generatedAdminPassword;
            serverPassword = sanitizeArkLaunchValue(arkConfig.ServerPassword || '', '');
        }
    } catch (e) {}

    mapName = normalizeArkMapName(mapName);
    sessionName = sanitizeArkLaunchValue(sessionName || opts.serverName, 'ARK_Server');
    adminPassword = sanitizeArkLaunchValue(adminPassword, generatedAdminPassword);
    serverPassword = sanitizeArkLaunchValue(serverPassword, '');

    const rconPort = opts.gamePort + 13;
    let connectionString = `${mapName}?listen?SessionName=${sessionName}?QueryPort=${opts.gamePort + 1}?RCONEnabled=True?RCONPort=${rconPort}?MaxPlayers=70`;
    if (serverPassword) {
        connectionString += `?ServerPassword=${serverPassword}`;
    }
    connectionString += `?ServerAdminPassword=${adminPassword}`;
    connectionString += ` -Port=${opts.gamePort} -WinLiveMaxPlayers=70 -ServerPlatform=ALL -NoBattlEye`;
    if (opts.clusterId) {
        connectionString += ` -clusterid=${opts.clusterId}`;
    }

    const publicBindings = {
        [`${opts.gamePort}/udp`]: [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort) }],
        [`${opts.gamePort + 1}/udp`]: [{ HostIp: '0.0.0.0', HostPort: String(opts.gamePort + 1) }],
        [`${rconPort}/tcp`]: [{ HostIp: '0.0.0.0', HostPort: String(rconPort) }]
    };
    const proxy = prepareGameProxyBindings(publicBindings, {
        enabled: config.oxideGameProxyEnabled,
        backendOffset: config.gameBackendPortOffset,
        backendBindIp: config.gameBackendBindIp
    });

    const container = await docker.createContainer({
        Image: config.arkBaseImage,
        name: opts.containerName,
        Env: [
            `startcommands=${connectionString}`,
            'TZ=UTC',
            // Instances are immutable clones of a validated master. Updating
            // here caused every server to contact Steam independently and a
            // failed manifest request still launched an obsolete build. A
            // fresh development node has no master yet, so its first instance
            // must bootstrap the game files from Steam.
            `updateonstart=${clonedFromMaster ? 'false' : 'true'}`
        ],
        Cmd: clonedFromMaster ? [
            '/bin/bash', '-c',
            'touch /home/steam/CONTAINER_ALREADY_STARTED_PLACEHOLDER && cp /home/steam/serverstart.sh /tmp/serverstart.sh && sed -i "s/+force_install_dir/+@sSteamCmdForcePlatformType windows +force_install_dir/g" /tmp/serverstart.sh && sed -i "s/echo .*steam_appid.txt//g" /tmp/serverstart.sh && echo 2399830 | tee "/home/steam/Steam/steamapps/common/ARK Survival Ascended Dedicated Server/ShooterGame/Binaries/Win64/steam_appid.txt" > /dev/null || true && bash /tmp/serverstart.sh'
        ] : ['/home/steam/serverstart.sh'],
        ExposedPorts: {
            [`${opts.gamePort}/udp`]: {},
            [`${opts.gamePort + 1}/udp`]: {},
            [`${rconPort}/tcp`]: {}
        },
        Tty: true,
        OpenStdin: true,
        NetworkingConfig: { EndpointsConfig: { [config.dockerNetwork]: {} } },
        HostConfig: buildARKHostConfig(opts, clusterBinds, proxy.bindings),
        Labels: {
            'ragenodes.server_id': String(opts.serverId),
            'ragenodes.game': 'ark',
            ...proxy.labels
        }
    });

    await container.start();
    try {
        const { query } = await import('../../db.js');
        const { sendWebhookNotification } = await import('../discordWebhookService.js');
        const res = await query("SELECT name, discord_webhook_url, discord_webhook_events FROM servers WHERE container_name = $1", [opts.containerName]);
        if (res.rowCount > 0) {
            const s = res.rows[0];
            await sendWebhookNotification(s.discord_webhook_url, s.discord_webhook_events, 'online', s.name);
        }
    } catch (e) {}

    return container;
}

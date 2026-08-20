import { getNodeConnection, runRemoteCommand, localDocker, GAME_SECURITY_CONFIG, cloneFromMasterTemplate, detachMutableTemplatePath, deriveServicePassword, sh } from '../dockerUtils.js';
import path from 'path';
import { config } from '../../config.js';

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

export function buildARKHostConfig(opts, clusterBinds = []) {
    return {
        NetworkMode: 'host',
        Binds: [`${opts.dataPath}:/home/steam/Steam/steamapps`, ...clusterBinds],
        RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
        Memory: opts.plan.memoryBytes,
        NanoCpus: opts.plan.nanoCpus,
        CpuShares: Math.round((opts.plan.nanoCpus / 10**9) * 1024),
        ShmSize: 1024 * 1024 * 1024,
        BlkioWeight: 100,
        ...GAME_SECURITY_CONFIG,
        CapAdd: ARK_CAPABILITIES,
        PidsLimit: 2048,
        Init: true
    };
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
    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${opts.dataPath} && chown -R 1000:1000 ${opts.dataPath}`);

    await cloneFromMasterTemplate('ark', opts.dataPath, opts.nodeId);
    await detachMutableTemplatePath(path.join(opts.dataPath, 'compatdata'), opts.nodeId);

    const baseArkPath = path.join(opts.dataPath, 'common', 'ARK Survival Ascended Dedicated Server');
    const shooterPath = path.join(baseArkPath, 'ShooterGame');
    const win64Path = path.join(shooterPath, 'Binaries', 'Win64');

    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${win64Path}`);
    await detachMutableTemplatePath(path.join(shooterPath, 'Saved'), opts.nodeId);
    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p "${opts.dataPath}/compatdata/2430930"`);
    await runRemoteCommand(opts.nodeId || 0, sh`chown -R 1000:1000 ${opts.dataPath}`);

    try {
        await runRemoteCommand(opts.nodeId || 0, sh`echo 2430930 > "${baseArkPath}/steam_appid.txt" && echo 2430930 > "${shooterPath}/steam_appid.txt" && echo 2430930 > "${win64Path}/steam_appid.txt" && chown 1000:1000 "${baseArkPath}/steam_appid.txt" "${shooterPath}/steam_appid.txt" "${win64Path}/steam_appid.txt" && chmod 644 "${baseArkPath}/steam_appid.txt" "${shooterPath}/steam_appid.txt" "${win64Path}/steam_appid.txt"`);
    } catch (e) {}

    try {
        await runRemoteCommand(opts.nodeId || 0, sh`chown -R 1000:1000 ${opts.dataPath}`);
    } catch (e) {}

    const clusterBinds = [];
    if (opts.clusterId) {
        const clusterDir = `/var/lib/ragenodes/clusters/${opts.clusterId}`;
        await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${clusterDir}`).catch(() => {});
        try { await runRemoteCommand(opts.nodeId || 0, sh`chown -R 1000:1000 ${clusterDir}`); } catch (e) {}
        clusterBinds.push(`${clusterDir}:/home/steam/Steam/steamapps/common/ARK Survival Ascended Dedicated Server/ShooterGame/Saved/clusters/${opts.clusterId}`);
    }

    try { await docker.getImage(config.arkBaseImage).inspect(); }
    catch (e) {
        console.log(`🚚 [Docker] Descargando imagen ${config.arkBaseImage}...`);
        const stream = await docker.pull(config.arkBaseImage);
        await new Promise((resolve, reject) => { docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res)); });
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

    let connectionString = `${mapName}?listen?SessionName=${sessionName}?Port=${opts.gamePort}?QueryPort=${opts.gamePort + 1}?MaxPlayers=70`;
    if (serverPassword) {
        connectionString += `?ServerPassword=${serverPassword}`;
    }
    connectionString += `?ServerAdminPassword=${adminPassword}`;
    connectionString += ` -WinLiveMaxPlayers=70 -NoBattlEye`;
    if (opts.clusterId) {
        connectionString += ` -clusterid=${opts.clusterId}`;
    }

    const container = await docker.createContainer({
        Image: config.arkBaseImage,
        name: opts.containerName,
        Env: [
            `startcommands=${connectionString}`,
            'TZ=UTC',
            'updateonstart=true'
        ],
        Cmd: [
            '/bin/bash', '-c',
            'cp /home/steam/serverstart.sh /tmp/serverstart.sh && sed -i "s/+force_install_dir/+@sSteamCmdForcePlatformType windows +force_install_dir/g" /tmp/serverstart.sh && sed -i "s/echo .*steam_appid.txt//g" /tmp/serverstart.sh && echo 2430930 | tee "/home/steam/Steam/steamapps/common/ARK Survival Ascended Dedicated Server/ShooterGame/Binaries/Win64/steam_appid.txt" > /dev/null || true && bash /tmp/serverstart.sh'
        ],
        ExposedPorts: {
            [`${opts.gamePort}/udp`]: {},
            [`${opts.gamePort}/tcp`]: {},
            [`${opts.gamePort + 1}/udp`]: {},
            '27015/udp': {},
            [`${opts.gamePort + 13}/tcp`]: {}
        },
        Tty: true,
        OpenStdin: true,
        HostConfig: buildARKHostConfig(opts, clusterBinds)
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

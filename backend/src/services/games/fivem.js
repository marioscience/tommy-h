import { getNodeConnection, runRemoteCommand, GAME_SECURITY_CONFIG, applyRageNodesBranding , sh } from '../dockerUtils.js';
import { config } from '../../config.js';

export async function createFivemContainer(opts) {
    const docker = await getNodeConnection(opts.nodeId || 0);
    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p ${opts.dataPath} && chown -R 1000:1000 ${opts.dataPath}`);
    await runRemoteCommand(opts.nodeId || 0, sh`mkdir -p "${opts.dataPath}/txData"`);
    try {
        await runRemoteCommand(opts.nodeId || 0, sh`chown -R 1000:1000 ${opts.dataPath} && chmod -R u=rwX,g=rX,o= ${opts.dataPath}`);
    } catch (e) {}

    const container = await docker.createContainer({
        Image: config.fivemBaseImage,
        name: opts.containerName,
        Env: [
            `TXADMIN_PORT=${opts.txadminPort}`,
            `FIVEM_PORT=${opts.fivemPort}`,
            `TXHOST_TXA_PORT=${opts.txadminPort}`,
            `TXHOST_FXS_PORT=${opts.fivemPort}`,
            `TXHOST_INTERFACE=0.0.0.0`,
            `TXHOST_DATA_PATH=/opt/fivem/txData`,
            `TXHOST_GAME_NAME=fivem`,
            `TXHOST_IGNORE_DEPRECATED_CONFIGS=true`,
            ...(opts.txadminPort ? [`TXHOST_TXA_URL=https://tx${opts.txadminPort}.ragenodes.com/`] : []),
            ...(opts.dbName ? [`DB_NAME=${opts.dbName}`] : []),
            ...(opts.dbUser ? [`DB_USER=${opts.dbUser}`] : []),
            ...(opts.dbPass ? [`DB_PASS=${opts.dbPass}`] : []),
            ...(opts.dbName ? [`TXHOST_DEFAULT_DBNAME=${opts.dbName}`] : []),
            ...(opts.dbUser ? [`TXHOST_DEFAULT_DBUSER=${opts.dbUser}`] : []),
            ...(opts.dbPass ? [`TXHOST_DEFAULT_DBPASS=${opts.dbPass}`] : []),
            `TXHOST_DEFAULT_DBHOST=mariadb`,
            `TXHOST_DEFAULT_DBPORT=3306`,
            `SERVER_NAME=${opts.serverName}`,
            `LICENSE_KEY=${opts.licenseKey}`,
            `FIVEM_PUBLIC_HOST=${config.fivemPublicHost}`
        ],
        ExposedPorts: { [`${opts.fivemPort}/tcp`]: {}, [`${opts.fivemPort}/udp`]: {}, [`${opts.txadminPort}/tcp`]: {} },
        NetworkingConfig: {
            EndpointsConfig: {
                [config.dockerNetwork]: {}
            }
        },
        HostConfig: {
            Binds: [
                `${opts.dataPath}:/data`,
                `${opts.dataPath}/txData:/opt/fivem/txData`
            ],
            PortBindings: {
                [`${opts.fivemPort}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: String(opts.fivemPort) }],
                [`${opts.fivemPort}/udp`]: [{ HostIp: "0.0.0.0", HostPort: String(opts.fivemPort) }],
                [`${opts.txadminPort}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: String(opts.txadminPort) }]
            },
            RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
            Memory: opts.plan.memoryBytes,
            NanoCpus: opts.plan.nanoCpus, CpuShares: Math.round((opts.plan.nanoCpus / 10**9) * 1024),
            BlkioWeight: config.dockerBlkioWeight,
            ExtraHosts: ["host.docker.internal:host-gateway"],
            ...GAME_SECURITY_CONFIG
        }
    });

    await container.start();
    applyRageNodesBranding(container, opts.containerName);
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

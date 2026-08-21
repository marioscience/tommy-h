import Docker from 'dockerode';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { exec } from 'child_process';
import util from 'util';
import crypto from 'crypto';

const execAsync = util.promisify(exec);

export const localDocker = new Docker({ socketPath: config.dockerSocket });
export const NODE_CONNECTIONS = new Map();

export function deriveServicePassword(scope, identifier) {
    return crypto.createHmac('sha256', config.jwtSecret)
        .update(`${scope}:${identifier}`)
        .digest('base64url')
        .slice(0, 32);
}

export const GAME_SECURITY_CONFIG = {
    SecurityOpt: ["no-new-privileges:true"],
    CapDrop: ["ALL"],
    CapAdd: ["CHOWN", "SETUID", "SETGID", "NET_BIND_SERVICE", "KILL", "DAC_OVERRIDE", "DAC_READ_SEARCH"],
    LogConfig: {
        Type: 'json-file',
        Config: {
            'max-size': '20m',
            'max-file': '3'
        }
    }
};

export async function runRemoteCommand(nodeId, command) {
    if (!nodeId || nodeId == 0 || nodeId == '0') {
        return execAsync(command);
    }
    try {
        const docker = await getNodeConnection(nodeId);
        try {
            await docker.getImage('alpine@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b').inspect();
        } catch(e) {
            console.log('[Docker] Pulling alpine on node ' + nodeId + '...');
            const stream = await docker.pull('alpine@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b');
            await new Promise((resolve, reject) => {
                docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
            });
        }
        const container = await docker.createContainer({
            Image: 'alpine@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b',
            Cmd: ['sh', '-c', command],
            HostConfig: {
                Binds: ['/srv/ragenodes-data:/srv/ragenodes-data'],
                AutoRemove: true
            }
        });
        await container.start();
        await container.wait();
        return true;
    } catch (err) {
        console.error('[NodeHostCmd] Error on node ' + nodeId + ':', err.message);
        throw err;
    }
}

export async function getNodeConnection(nodeId = 0) {
    if (nodeId === 0 || nodeId === '0') return localDocker;
    if (NODE_CONNECTIONS.has(nodeId)) return NODE_CONNECTIONS.get(nodeId);

    try {
        const { query } = await import('../db.js');
        const res = await query("SELECT * FROM nodes WHERE id = $1", [nodeId]);
        if (res.rowCount === 0) throw new Error(`Nodo ${nodeId} no encontrado.`);

        const node = res.rows[0];
        const certsDir = path.join(config.projectRoot, 'certs');

        const dockerOpts = {
            host: node.ip_address,
            port: 2376
        };

        try {
            const caPath = path.join(certsDir, 'ca', 'ca.pem');
            const certPath = path.join(certsDir, 'nodes', String(nodeId), 'cert.pem');
            const keyPath = path.join(certsDir, 'nodes', String(nodeId), 'key.pem');

            const [ca, cert, key] = await Promise.all([
                fs.readFile(caPath),
                fs.readFile(certPath),
                fs.readFile(keyPath)
            ]);

            dockerOpts.protocol = 'https';
            dockerOpts.ca = ca;
            dockerOpts.cert = cert;
            dockerOpts.key = key;
            console.log(`🔒 [Docker] Conexión cifrada (mTLS) establecida con Nodo #${nodeId}`);
        } catch (err) {
            if (!config.allowInsecureDockerNodes || config.nodeEnv === 'production') {
                throw new Error(`Nodo #${nodeId} rechazado: faltan certificados mTLS válidos.`);
            }
            dockerOpts.protocol = 'http';
            dockerOpts.port = 2375;
            console.warn(`⚠️ [Docker] Nodo #${nodeId} usa HTTP sin cifrar por excepción exclusiva de desarrollo.`);
        }

        const remoteDocker = new Docker(dockerOpts);
        NODE_CONNECTIONS.set(nodeId, remoteDocker);
        return remoteDocker;
    } catch (e) {
        console.error(`❌ [Docker] Error conectando al nodo ${nodeId}:`, e.message);
        throw e;
    }
}

export async function detachMutableTemplatePath(dirPath, nodeId = 0) {
    const tmpPath = dirPath + '.detached-tmp-' + Date.now();
    const oldPath = dirPath + '.detached-old-' + Date.now();
    try {
        const checkCmd = `[ -d "${dirPath}" ] && echo "yes" || echo "no"`;
        const exists = await runRemoteCommand(nodeId, checkCmd);
        if (exists.trim() !== 'yes') return;

        await runRemoteCommand(nodeId, sh`cp -a ${dirPath} ${tmpPath}`);
        await runRemoteCommand(nodeId, sh`mv ${dirPath} ${oldPath}`);
        await runRemoteCommand(nodeId, sh`mv ${tmpPath} ${dirPath}`);
        runRemoteCommand(nodeId, sh`rm -rf ${oldPath}`).catch(() => {});
    } catch (e) {
        console.warn(`[Templates] No se pudo separar ${dirPath} de la plantilla maestra: ${e.message}`);
        runRemoteCommand(nodeId, sh`rm -rf ${tmpPath}`).catch(() => {});
    }
}

export async function cloneFromMasterTemplate(gameName, dataPath, nodeId = 0) {
    if (gameName === 'fivem' || gameName === 'minecraft') {
        console.log(`ℹ️ [${gameName.toUpperCase()}] Omitiendo plantilla maestra.`);
        return false;
    }

    const masterPath = path.join(config.instanceDataRoot, 'templates', `${gameName}-master`);
    try {
        try {
            const dataStats = await fs.stat(dataPath);
            const files = await fs.readdir(dataPath);
            if (files.length > 0) {
                console.log(`ℹ️ [${gameName.toUpperCase()}] El directorio ${dataPath} ya existe y contiene datos. Omitiendo clonación de plantilla maestra para preservar la configuración del usuario.`);
                return true;
            }
        } catch (e) { }

        const masterStats = await fs.stat(masterPath);
        if (masterStats.isDirectory()) {
            console.log(`⚡ [${gameName.toUpperCase()}] Plantilla maestra detectada en ${masterPath}. Clonando usando BTRFS Copy-on-Write / Hard Links...`);
            await runRemoteCommand(nodeId, sh`mkdir -p ${dataPath}`);
            try {
                await runRemoteCommand(nodeId, sh`cp --reflink=always -a "${masterPath}/." "${dataPath}/"`);
            } catch (reflinkErr) {
                console.warn(`⚠️ [${gameName.toUpperCase()}] Reflinks no disponibles (${reflinkErr.message}). Intentando Hard links...`);
                try {
                    await runRemoteCommand(nodeId, sh`cp -al "${masterPath}/." "${dataPath}/"`);
                } catch (linkErr) {
                    console.warn(`⚠️ [${gameName.toUpperCase()}] Hard links no disponibles (${linkErr.message}). Copiando desde plantilla maestra normal...`);
                    await runRemoteCommand(nodeId, sh`cp -a "${masterPath}/." "${dataPath}/"`);
                }
            }
            console.log(`⚡ [${gameName.toUpperCase()}] Plantilla maestra aplicada con éxito.`);
            try { 
                await runRemoteCommand(nodeId, sh`chown -R 1000:1000 ${dataPath} && chmod -R u=rwX,g=rX,o= ${dataPath}`);
            } catch (e) {}
            return true;
        }
    } catch (e) {
        console.log(`ℹ️ [${gameName.toUpperCase()}] Plantilla maestra no encontrada en ${masterPath}. Se descargará desde cero.`);
    }
    return false;
}

export async function applyRageNodesBranding(container, name = "Unknown", retries = 5) {
    const TX_PATH = "/opt/fivem/alpine/opt/cfx-server/citizen/system_resources/monitor/panel/index.html";
    const brandingScript = `
        <!-- RAGENODES_WHITE_LABEL_PATCH_START -->
        <style id="ragenodes-white-label-style">
            :root { --primary: #6366f1 !important; --dark: #0f172a !important; }
            a[href*='zap-hosting'],
            a[href*='zoxhosting'],
            a[href*='zox-hosting'],
            a[href*='txadmin.gg'],
            img[src*='zap'],
            img[src*='zox'],
            img[alt*='zap' i],
            img[alt*='zox' i],
            div[class*='Zap'],
            [class*='sponsor'],
            [class*='Sponsor'],
            [class*='advert'],
            [class*='Advert'],
            .footer-text {
                display: none !important;
                visibility: hidden !important;
                pointer-events: none !important;
            }
            .navbar-brand img { content: url('https://ragenodes.com/logo.png') !important; height: 30px !important; }
        </style>
        <script id="ragenodes-white-label-script">
            (() => {
                if (window.__RAGENODES_WHITE_LABEL_ACTIVE__) return;
                window.__RAGENODES_WHITE_LABEL_ACTIVE__ = true;
                const blocked = ['zox hosting', 'zap-hosting', 'zap hosting', 'official fivem server provider', 'recommended official fivem'];
                const hideNode = (el) => {
                    if (!el || el.id === 'ragenodes-white-label-script') return;
                    el.style.setProperty('display', 'none', 'important');
                    el.style.setProperty('visibility', 'hidden', 'important');
                    el.style.setProperty('pointer-events', 'none', 'important');
                    el.setAttribute('data-ragenodes-hidden', 'true');
                };
                const hideBranding = () => {
                    if (window.txConsts) window.txConsts.adsData = {};
                    document.title = document.title.replace(/txAdmin/gi, 'RageNodes');
                    document.querySelectorAll('a, img, svg, picture, source').forEach((el) => {
                        const href = String(el.getAttribute?.('href') || el.getAttribute?.('src') || el.getAttribute?.('srcset') || el.getAttribute?.('alt') || '').toLowerCase();
                        if (href.includes('zap') || href.includes('zox')) hideNode(el.closest?.('a') || el);
                    });
                    document.querySelectorAll('a, button, small, span, p, div').forEach((el) => {
                        if (el.closest && el.closest('form')) return;
                        if (el.querySelector && (el.querySelector('input') || el.querySelector('[role="checkbox"]'))) return;
                        const text = String(el.textContent || '').toLowerCase().replace(/\\s+/g, ' ').trim();
                        if (text.includes('agree') || text.includes('accept') || text.includes('terms') || text.includes('terminos') || text.includes('términos') || text.includes('acuerdo') || text.includes('acept')) return;
                        if (text && text.length < 180 && blocked.some((term) => text.includes(term))) hideNode(el.closest?.('a') || el);
                    });
                };
                hideBranding();
                setInterval(hideBranding, 1500);
                new MutationObserver(hideBranding).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
            })();
        </script>
        <!-- RAGENODES_WHITE_LABEL_PATCH_END -->
    `;

    for (let i = 0; i < retries; i++) {
        try {
            const checkExec = await container.exec({ Cmd: ['ls', TX_PATH] });
            const checkStream = await checkExec.start();
            let fileExists = await new Promise(res => {
                checkStream.on('data', d => res(d.toString().includes('index.html')));
                checkStream.on('end', () => res(false));
            });

            if (fileExists) {
                const cleanBranding = brandingScript.replace(/"/g, '\\"').replace(/\n/g, '');
                const command = `sed -i "/RAGENODES_WHITE_LABEL_PATCH_START/,/RAGENODES_WHITE_LABEL_PATCH_END/d; /RAGENODES_WHITE_LABEL_PATCH_V[0-9]/,/script>/d" ${TX_PATH}; sed -i "s@</head>@${cleanBranding}</head>@g" ${TX_PATH}`;
                const exec = await container.exec({ Cmd: ['sh', '-c', command] });
                await exec.start();
                return;
            }
            await new Promise(r => setTimeout(r, 5000));
        } catch (err) {
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

export async function getDockerForContainer(name) {
    try {
        const { query } = await import('../db.js');
        const res = await query("SELECT node_id FROM servers WHERE container_name = $1", [name]);
        const nodeId = (res.rowCount > 0) ? res.rows[0].node_id : 0;
        return await getNodeConnection(nodeId);
    } catch (e) {
        return localDocker;
    }
}

export async function recreateContainer(name, createFn, opts) {
    try {
        const docker = await getDockerForContainer(name);
        const c = docker.getContainer(name);
        try { await c.stop({ t: 10 }); } catch (e) {}
        try { await c.remove({ force: true }); } catch (e) {}
        await new Promise(r => setTimeout(r, 1000));
    } catch (e) { }

    if (!opts.nodeId) {
        try {
            const { query } = await import('../db.js');
            const res = await query("SELECT node_id FROM servers WHERE container_name = $1", [name]);
            if (res.rowCount > 0) opts.nodeId = res.rows[0].node_id;
        } catch (e) {}
    }

    return await createFn(opts);
}


export function sh(strings, ...values) {
    return strings.reduce((acc, str, i) => {
        const val = values[i-1];
        const escapedVal = typeof val === 'string' ? "'" + val.replace(/'/g, "'\\''") + "'" : val;
        return acc + escapedVal + str;
    });
}

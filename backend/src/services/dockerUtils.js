import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import crypto from 'crypto';
import { findServerNodeIdByContainer } from '../repositories/serverRepository.js';
import { commandStdout, getNodeConnection, runRemoteCommand } from './dockerNodeService.js';
export { commandStdout, getNodeConnection, runRemoteCommand } from './dockerNodeService.js';

export async function normalizeBindOwnership(docker, image, dataPath, owner, helperScope = 'service') {
    const safeScope = String(helperScope || 'service').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 24);
    const helperName = `ragenodes-${safeScope}-permissions-${crypto.randomBytes(6).toString('hex')}`;
    let helper;
    try {
        helper = await docker.createContainer({
            Image: image,
            name: helperName,
            User: '0:0',
            Entrypoint: ['/bin/sh', '-c'],
            Cmd: [`chown -R ${owner} /target`],
            HostConfig: {
                Binds: [`${dataPath}:/target`],
                NetworkMode: 'none',
                ReadonlyRootfs: true,
                CapDrop: ['ALL'],
                CapAdd: ['CHOWN', 'FOWNER', 'DAC_OVERRIDE'],
                SecurityOpt: ['no-new-privileges:true']
            }
        });
        await helper.start();
        const result = await helper.wait();
        if (Number(result?.StatusCode) !== 0) {
            throw new Error(`el normalizador de permisos termino con codigo ${result?.StatusCode}`);
        }
    } finally {
        if (helper) await helper.remove({ force: true }).catch(() => {});
    }
}

export async function detachMutableTemplatePath(dirPath, nodeId = 0) {
    const tmpPath = dirPath + '.detached-tmp-' + Date.now();
    const oldPath = dirPath + '.detached-old-' + Date.now();
    try {
        const checkCmd = `[ -d "${dirPath}" ] && echo "yes" || echo "no"`;
        const exists = commandStdout(await runRemoteCommand(nodeId, checkCmd));
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

const TEMPLATE_CLONE_RESERVE_BYTES = 15 * 1024 ** 3;

export function selectTemplateCloneStrategy({ sourceDevice, targetDevice, templateBytes, availableBytes, reserveBytes = TEMPLATE_CLONE_RESERVE_BYTES }) {
    const source = String(sourceDevice || '').trim();
    const target = String(targetDevice || '').trim();
    const required = Math.max(0, Number(templateBytes) || 0);
    const available = Math.max(0, Number(availableBytes) || 0);
    const reserve = Math.max(0, Number(reserveBytes) || 0);
    if (!source || !target) throw new Error('No se pudo determinar el dispositivo de la plantilla y del destino.');
    if (source !== target && available < required + reserve) {
        const requiredGb = ((required + reserve) / 1024 ** 3).toFixed(1);
        const availableGb = (available / 1024 ** 3).toFixed(1);
        throw new Error(`Espacio insuficiente para clonar la plantilla entre sistemas de archivos: se requieren ${requiredGb} GB (incluida la reserva) y hay ${availableGb} GB disponibles.`);
    }
    return source === target ? 'reflink' : 'copy';
}

export function templateCacheMatches(markerValue, templateBytes) {
    const markerBytes = Number.parseInt(String(markerValue || '').trim(), 10);
    return Number.isSafeInteger(markerBytes) && markerBytes === Number(templateBytes);
}

function numericCommandOutput(result, label) {
    const value = Number.parseInt(commandStdout(result).trim(), 10);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`No se pudo medir ${label}.`);
    return value;
}

export function buildTemplateStreamCommand(masterPath, dataPath) {
    const source = sh`${masterPath}`;
    const target = sh`${dataPath}`;
    return `(cd ${source} && tar -cf - .) | (cd ${target} && tar -xf -)`;
}

async function copyTemplateAcrossFilesystems(masterPath, dataPath, nodeId) {
    const command = buildTemplateStreamCommand(masterPath, dataPath);
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await runRemoteCommand(nodeId, command);
            return;
        } catch (error) {
            lastError = error;
            console.warn(`[Templates] Copia por flujo interrumpida; reanudando intento ${attempt}/3: ${error.message}`);
        }
    }
    throw lastError;
}

export async function cloneFromMasterTemplate(gameName, dataPath, nodeId = 0, options = {}) {
    const refreshExisting = options.refreshExisting === true;
    const preservePaths = Array.isArray(options.preservePaths) ? options.preservePaths : [];
    for (const relativePath of preservePaths) {
        if (!relativePath || path.posix.isAbsolute(relativePath) || path.posix.normalize(relativePath).startsWith('../')) {
            throw new Error(`Ruta preservada no válida para ${gameName}.`);
        }
    }
    if (gameName === 'fivem' || gameName === 'minecraft') {
        console.log(`ℹ️ [${gameName.toUpperCase()}] Omitiendo plantilla maestra.`);
        return false;
    }

    const masterPath = path.join(config.instanceDataRoot, 'templates', `${gameName}-master`);
    try {
        const files = await fs.readdir(dataPath).catch(() => []);
        if (files.length > 0 && !refreshExisting) {
            console.log(`ℹ️ [${gameName.toUpperCase()}] El directorio ${dataPath} ya contiene datos. Se preserva sin volver a clonar.`);
            return true;
        }
        if (files.length > 0) {
            console.log(`⚡ [${gameName.toUpperCase()}] Actualizando runtime desde la plantilla y preservando datos mutables.`);
        }
        const masterStats = await fs.stat(masterPath).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
        if (!masterStats?.isDirectory()) {
            console.log(`ℹ️ [${gameName.toUpperCase()}] Plantilla maestra no encontrada en ${masterPath}. Se descargará desde cero.`);
            return false;
        }

        const parentPath = path.dirname(dataPath);
        await runRemoteCommand(nodeId, sh`mkdir -p ${parentPath}`);
        const [sourceDeviceResult, targetDeviceResult, templateSizeResult, availableSizeResult] = await Promise.all([
            runRemoteCommand(nodeId, sh`stat -c %d ${masterPath}`),
            runRemoteCommand(nodeId, sh`stat -c %d ${parentPath}`),
            runRemoteCommand(nodeId, sh`du -sb ${masterPath} | cut -f1`),
            runRemoteCommand(nodeId, sh`df -PB1 ${parentPath} | awk 'NR==2 {print $4}'`)
        ]);
        const sourceDevice = commandStdout(sourceDeviceResult).trim();
        const targetDevice = commandStdout(targetDeviceResult).trim();
        const templateBytes = numericCommandOutput(templateSizeResult, 'el tamaño de la plantilla');
        const availableBytes = numericCommandOutput(availableSizeResult, 'el espacio disponible');
        const reserveBytes = Math.max(1, Number(process.env.TEMPLATE_CLONE_FREE_RESERVE_GB || 15)) * 1024 ** 3;
        let cloneSourcePath = masterPath;
        let strategy = selectTemplateCloneStrategy({ sourceDevice, targetDevice, templateBytes, availableBytes, reserveBytes });

        if (strategy === 'copy') {
            const cacheRoot = path.join(config.instanceDataRoot, '.template-cache');
            const cachePath = path.join(cacheRoot, `${gameName}-master`);
            const cacheMarker = path.join(cachePath, '.ragenodes-template-bytes');
            const markerResult = await runRemoteCommand(nodeId, sh`cat ${cacheMarker} 2>/dev/null || true`);
            if (!templateCacheMatches(commandStdout(markerResult), templateBytes)) {
                const cacheTemp = `${cachePath}.seed-${crypto.randomUUID()}`;
                const cacheOld = `${cachePath}.old-${crypto.randomUUID()}`;
                console.log(`⚡ [${gameName.toUpperCase()}] Sembrando una única caché local desde la plantilla compartida.`);
                try {
                    await runRemoteCommand(nodeId, sh`mkdir -p ${cacheRoot} && rm -rf ${cacheTemp} && mkdir -p ${cacheTemp}`);
                    await copyTemplateAcrossFilesystems(masterPath, cacheTemp, nodeId);
                    await runRemoteCommand(nodeId, sh`printf '%s\n' ${String(templateBytes)} > ${path.join(cacheTemp, '.ragenodes-template-bytes')}`);
                    await runRemoteCommand(nodeId, sh`if [ -e ${cachePath} ]; then mv ${cachePath} ${cacheOld}; fi; mv ${cacheTemp} ${cachePath}; rm -rf ${cacheOld}`);
                } catch (error) {
                    await runRemoteCommand(nodeId, sh`rm -rf ${cacheTemp}`).catch(() => {});
                    throw new Error(`No se pudo preparar la caché local de ${gameName}: ${error.message}`);
                }
            } else {
                console.log(`⚡ [${gameName.toUpperCase()}] Reutilizando caché local validada.`);
            }
            cloneSourcePath = cachePath;
            strategy = 'reflink';
        }

        const clonePath = `${dataPath}.clone-${crypto.randomUUID()}`;
        console.log(`⚡ [${gameName.toUpperCase()}] Clonación atómica desde plantilla (${strategy}, ${(templateBytes / 1024 ** 3).toFixed(1)} GB).`);
        try {
            await runRemoteCommand(nodeId, sh`rm -rf ${clonePath} && mkdir -p ${clonePath}`);
            try {
                await runRemoteCommand(nodeId, sh`cp --reflink=always -R -P --preserve=mode,timestamps,links ${cloneSourcePath + '/.'} ${clonePath + '/'}`);
            } catch (reflinkError) {
                const currentAvailableResult = await runRemoteCommand(nodeId, sh`df -PB1 ${parentPath} | awk 'NR==2 {print $4}'`);
                selectTemplateCloneStrategy({ sourceDevice: 'copy-source', targetDevice: 'copy-target', templateBytes, availableBytes: numericCommandOutput(currentAvailableResult, 'el espacio disponible después de preparar la caché'), reserveBytes });
                console.warn(`⚠️ [${gameName.toUpperCase()}] Reflink no disponible; se usará copia independiente con espacio ya validado.`);
                await runRemoteCommand(nodeId, sh`rm -rf ${clonePath} && mkdir -p ${clonePath} && cp -R -P --preserve=mode,timestamps,links ${cloneSourcePath + '/.'} ${clonePath + '/'}`);
            }
            if (files.length > 0 && refreshExisting) {
                for (const relativePath of preservePaths) {
                    const source = path.join(dataPath, relativePath);
                    const destination = path.join(clonePath, relativePath);
                    const destinationParent = path.dirname(destination);
                    await runRemoteCommand(nodeId, sh`if [ -e ${source} ]; then rm -rf ${destination}; mkdir -p ${destinationParent}; cp --reflink=always -R -P --preserve=mode,timestamps,links ${source} ${destination}; fi`);
                }
                const oldPath = `${dataPath}.old-${crypto.randomUUID()}`;
                await runRemoteCommand(nodeId, sh`test -n "$(find ${clonePath} -mindepth 1 -print -quit)" || exit 1; rm -f ${path.join(clonePath, '.ragenodes-template-bytes')}; test ! -e ${oldPath}; mv ${dataPath} ${oldPath}; if mv ${clonePath} ${dataPath}; then true; else mv ${oldPath} ${dataPath}; exit 1; fi`);
                // Runtime files created by rootless Proton may not be removable
                // by the backend uid. Cleanup is best effort and must never
                // turn an already successful atomic promotion into a rollback.
                runRemoteCommand(nodeId, sh`rm -rf ${oldPath}`).catch((cleanupError) => {
                    console.warn(`[Templates] Runtime anterior pendiente de limpieza (${oldPath}): ${cleanupError.message}`);
                });
            } else {
                await runRemoteCommand(nodeId, sh`test -n "$(find ${clonePath} -mindepth 1 -print -quit)" || exit 1; rm -f ${path.join(clonePath, '.ragenodes-template-bytes')}; if [ -d ${dataPath} ]; then rmdir ${dataPath}; fi; test ! -e ${dataPath}; mv ${clonePath} ${dataPath}`);
            }
        } catch (error) {
            await runRemoteCommand(nodeId, sh`rm -rf ${clonePath}`).catch(() => {});
            throw new Error(`No se pudo clonar de forma segura la plantilla ${gameName}: ${error.message}`);
        }

        try { await runRemoteCommand(nodeId, sh`chown -R 1000:1000 ${dataPath} && chmod -R u=rwX,g=rX,o= ${dataPath}`); } catch {}
        console.log(`⚡ [${gameName.toUpperCase()}] Plantilla maestra aplicada con éxito.`);
        return true;
    } catch (error) {
        if (String(error?.message || '').includes('Espacio insuficiente')) throw error;
        throw new Error(`Falló la preparación de la plantilla ${gameName}: ${error.message}`);
    }
}

export async function getDockerForContainer(name) {
    try {
        const nodeId = await findServerNodeIdByContainer(name);
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
            opts.nodeId = await findServerNodeIdByContainer(name);
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

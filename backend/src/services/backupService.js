import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { config, PLAN_LIMITS } from '../config.js';
import { getServerByIdForUser, controlServer } from './serverService.js';
import { logAudit } from '../db.js';
import { deleteBackupRecord, findBackupRecord, recordBackup } from '../repositories/backupRepository.js';
import { hasManagedDatabase } from './backupPolicy.js';
import { getNodeConnection } from './dockerUtils.js';
import { normalizeSharedDataPermissions } from './games/BaseGameService.js';
import { rustUtil } from '../utils/rustUtil.js';

const MAX_ERROR_LOG_BYTES = 1024 * 1024;

function runProcess(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            shell: false,
            cwd: options.cwd,
            env: { ...process.env, ...(options.env || {}) },
            stdio: ['pipe', options.captureStdout ? 'pipe' : 'ignore', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        if (options.stdinFile) {
            const input = createReadStream(options.stdinFile);
            input.on('error', reject);
            input.pipe(child.stdin);
        } else {
            child.stdin.end();
        }

        if (options.captureStdout && child.stdout) {
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
        }

        child.stderr.on('data', (data) => {
            if (stderr.length < MAX_ERROR_LOG_BYTES) stderr += data.toString();
        });

        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`${command} fallo con codigo ${code}. Log: ${stderr.slice(0, 500)}`));
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

function mysqlEnv() {
    return { MYSQL_PWD: config.centralDbPass || '' };
}

function assertSafeDbName(dbName) {
    if (!dbName || !/^[a-zA-Z0-9_]+$/.test(dbName)) {
        throw new Error('Nombre de base de datos invalido.');
    }
}

function assertSafeDataPath(dataPath) {
    const root = path.resolve(config.instanceDataRoot);
    const target = path.resolve(String(dataPath || ''));
    if (!target.startsWith(`${root}${path.sep}`) || target.length < root.length + 2) {
        throw new Error('Ruta de datos invalida.');
    }
    return target;
}

async function createArchive(sourceDirectory, destination) {
    const partialPath = `${destination}.partial-${process.pid}-${Date.now()}`;
    try {
        if (config.backupArchiveEngine === 'rust' && rustUtil.runtimeInfo().nativeAvailable) {
            const result = await rustUtil.zstd(sourceDirectory, partialPath);
            if (!result.success) throw new Error(`Compresor Rust no disponible: ${result.error}`);
        } else {
            if (config.backupArchiveEngine === 'rust') {
                console.warn('[Backup] Rust solicitado pero el modulo nativo no esta disponible; usando tar de forma segura.');
            }
            await runProcess('tar', ['--zstd', '-cf', partialPath, '-C', sourceDirectory, '.']);
        }
        await fs.rename(partialPath, destination);
    } catch (error) {
        await fs.unlink(partialPath).catch(() => {});
        throw error;
    }
}

async function extractArchive(source, destination, maxExpandedBytes) {
    if (source.endsWith('.zst') && config.backupArchiveEngine === 'rust' && rustUtil.runtimeInfo().nativeAvailable) {
        const result = await rustUtil.unzstd(source, destination, maxExpandedBytes);
        if (!result.success) throw new Error(`Extractor Rust no disponible: ${result.error}`);
        return;
    }
    await runProcess('tar', source.endsWith('.zst')
        ? ['--zstd', '-xf', source, '-C', destination]
        : ['-xzf', source, '-C', destination]);
}

async function assertBackupIntegrity(serverId, filename, backupPath) {
    const record = await findBackupRecord(serverId, filename);
    if (!record?.checksum_sha256) return { verified: false, reason: 'legacy-without-checksum' };
    const actual = await rustUtil.sha256File(backupPath);
    if (actual !== record.checksum_sha256) {
        throw new Error('La copia no supera la validacion SHA-256 y no sera restaurada.');
    }
    return { verified: true, checksumSha256: actual };
}

async function prepareBackupReadAccess(server) {
    if (!server?.container_name) return;

    try {
        const docker = await getNodeConnection(server.node_id || 0);
        const container = docker.getContainer(server.container_name);
        await normalizeSharedDataPermissions(container, config.gameContainerSharedGid);
    } catch (error) {
        console.warn(`[Backup] No se pudieron normalizar los permisos de ${server.id}: ${error.message}`);
    }
}

function getBackupPathForServer(serverId, filename) {
    const shortId = serverId.slice(0, 8);
    const safeFilename = path.basename(filename || '');

    if (!safeFilename.startsWith(`backup_${shortId}_`) || !/\.tar\.(gz|zst)$/.test(safeFilename)) {
        throw new Error('Nombre de backup invalido para este servidor.');
    }

    const backupRoot = path.resolve(config.backupRoot);
    const backupPath = path.resolve(backupRoot, safeFilename);

    if (!backupPath.startsWith(`${backupRoot}${path.sep}`)) {
        throw new Error('Ruta de backup invalida.');
    }

    return { safeFilename, backupPath };
}

export async function syncBackupsToRemote() {
    if (!config.backupRemoteEnabled) {
        return { success: true, skipped: true, reason: 'disabled' };
    }

    const remoteName = String(config.backupRemoteName || '').trim();
    const remotePath = String(config.backupRemotePath || '').replace(/^\/+|\/+$/g, '');
    if (!/^[a-zA-Z0-9_-]+$/.test(remoteName) || !remotePath) {
        throw new Error('Configuracion de backup remoto invalida.');
    }

    const configStat = await fs.stat(config.rcloneConfigPath).catch(() => null);
    if (!configStat?.isFile()) {
        throw new Error(`RClone no esta configurado: falta un archivo regular en ${config.rcloneConfigPath}.`);
    }

    console.log(`[BackupRemote] Sincronizando backups con ${remoteName}:${remotePath}...`);
    await runProcess('rclone', [
        '--config', config.rcloneConfigPath,
        'sync',
        config.backupRoot,
        `${remoteName}:${remotePath}`
    ]);
    console.log('[BackupRemote] Sincronizacion completada.');
    return { success: true, skipped: false };
}

// Compatibilidad con integraciones antiguas; la implementacion ya no depende de Google Drive.
export const syncBackupsToGDrive = syncBackupsToRemote;

export async function createFullBackup(id, userId, isAdmin, customName = null) {
    const s = await getServerByIdForUser(id, userId, isAdmin, 'files');
    if (!s) throw new Error('Servidor no encontrado');
    s.data_path = assertSafeDataPath(s.data_path);
    const includesDatabase = hasManagedDatabase(s);
    if (includesDatabase) assertSafeDbName(s.db_name);

    await fs.mkdir(config.backupRoot, { recursive: true });

    const shortId = s.id.slice(0, 8);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const nameTag = customName ? customName.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'manual';
    const backupFileName = `backup_${shortId}_${nameTag}_${timestamp}.tar.zst`;
    const backupFilePath = path.join(config.backupRoot, backupFileName);
    const dbDumpFile = path.join(s.data_path, 'database_dump.sql');

    try {
        // Algunos motores crean carpetas privadas (0700) durante la ejecución.
        // El contenedor del juego puede normalizarlas sin elevar privilegios en
        // el worker, que conserva únicamente acceso por el grupo compartido.
        await prepareBackupReadAccess(s);

        if (includesDatabase) {
            await runProcess('mariadb-dump', [
                '--skip-ssl',
                '-h', process.env.MARIADB_HOST || 'mariadb',
                '-u', 'root',
                `--result-file=${dbDumpFile}`,
                s.db_name
            ], { env: mysqlEnv() });
        }

        await createArchive(s.data_path, backupFilePath);

        await fs.unlink(dbDumpFile).catch(() => {});

        const stat = await fs.stat(backupFilePath);
        const checksumSha256 = await rustUtil.sha256File(backupFilePath);
        await recordBackup({ serverId: s.id, filename: backupFileName, sizeBytes: stat.size, checksumSha256 });

        const planName = (s.runtime_plan || '').toLowerCase();
        let maxManualRetain = 1;
        let maxAutoRetain = 0;

        if (planName === 'standard') {
            maxManualRetain = 3;
            maxAutoRetain = 7;
        } else if (planName === 'premium' || planName === 'platinum') {
            maxManualRetain = 5;
            maxAutoRetain = 14;
        } else if (planName === 'partner') {
            maxManualRetain = 10;
            maxAutoRetain = 21;
        }

        const isAuto = nameTag === 'auto';
        enforceBackupRetentionPolicy(s.id, isAuto ? maxAutoRetain : maxManualRetain, isAuto)
            .catch(e => console.error('Fallo silencioso en retencion de backups', e));

        // Sincronizaci??n delegada al Scheduler para evitar Race Conditions

        await logAudit(userId, 'SERVER.BACKUP.CREATE', { serverId: s.id, customName, backupFileName });
        return { success: true, file: backupFileName, message: 'Backup completado' };
    } catch (err) {
        console.error('Error critico en backup:', err);
        await fs.unlink(dbDumpFile).catch(() => {});
        await fs.unlink(backupFilePath).catch(() => {});
        throw new Error('Fallo al generar la copia de seguridad.');
    }
}

async function enforceBackupRetentionPolicy(serverId, maxRetain = 5, isAuto = false) {
    if (maxRetain <= 0) return;

    try {
        const shortId = serverId.slice(0, 8);
        const files = await fs.readdir(config.backupRoot);
        const serverBackups = files.filter(f => {
            const belongsToServer = f.startsWith(`backup_${shortId}_`);
            if (!belongsToServer) return false;
            return isAuto ? f.startsWith(`backup_${shortId}_auto_`) : !f.startsWith(`backup_${shortId}_auto_`);
        });

        if (serverBackups.length <= maxRetain) return;

        serverBackups.sort((a, b) => b.localeCompare(a));
        const backupsToDelete = serverBackups.slice(maxRetain);

        console.log(`[Backup Retention] Purgando ${backupsToDelete.length} antiguos para ${shortId}. Limite: ${maxRetain}`);

        for (const fileToDelete of backupsToDelete) {
            try {
                await fs.unlink(path.join(config.backupRoot, fileToDelete));
                await deleteBackupRecord(serverId, fileToDelete);
                console.log(`[Backup Retention] Eliminado: ${fileToDelete}`);
            } catch (err) {
                console.error(`[Backup Retention] Error al eliminar ${fileToDelete}:`, err);
            }
        }
    } catch (err) {
        console.error(`[Backup Retention] Error critico durante la purga para ${serverId}:`, err);
    }
}

export async function listServerBackups(id, userId, isAdmin) {
    const s = await getServerByIdForUser(id, userId, isAdmin, 'files');
    if (!s) throw new Error('Servidor no encontrado');
    s.data_path = assertSafeDataPath(s.data_path);

    const shortId = s.id.slice(0, 8);
    try {
        const files = await fs.readdir(config.backupRoot);
        const serverBackups = files.filter(f => f.startsWith(`backup_${shortId}_`) && /\.tar\.(gz|zst)$/.test(f));

        return serverBackups.map(file => {
            const dateMatch = file.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.tar\.(gz|zst)$/);
            const datePart = dateMatch ? dateMatch[1] : 'Desconocida';

            return {
                filename: file,
                date: datePart !== 'Desconocida'
                    ? datePart.replace('T', ' ').replace(/-/g, ':').replace(/:\d{3}Z$/, '').slice(0, 16)
                    : 'Desconocida'
            };
        }).reverse();
    } catch (e) {
        return [];
    }
}

export async function restoreBackup(id, filename, userId, isAdmin) {
    const s = await getServerByIdForUser(id, userId, isAdmin, 'files');
    if (!s) throw new Error('Servidor no encontrado');
    s.data_path = assertSafeDataPath(s.data_path);
    const includesDatabase = hasManagedDatabase(s);
    if (includesDatabase) assertSafeDbName(s.db_name);

    const { safeFilename, backupPath } = getBackupPathForServer(s.id, filename);
    const dbDumpFile = path.join(s.data_path, 'database_dump.sql');
    const restoreNonce = `${process.pid}-${Date.now()}`;
    const restorePath = `${s.data_path}.restore-${restoreNonce}`;
    const previousPath = `${s.data_path}.previous-${restoreNonce}`;
    const rollbackDbDump = path.join(config.backupRoot, `.restore-db-${s.id}-${restoreNonce}.sql`);
    let originalMoved = false;
    let filesSwapped = false;
    let rollbackDatabaseAvailable = false;

    await controlServer(s.id, userId, 'stop', isAdmin);

    try {
        await assertBackupIntegrity(s.id, safeFilename, backupPath);
        await fs.mkdir(restorePath, { recursive: true });
        const plan = PLAN_LIMITS[String(s.runtime_plan || s.plan || 'hobby').toLowerCase()] || PLAN_LIMITS.hobby;
        const maxExpandedBytes = Number(plan.diskBytes) + (Number(s.extra_disk_gb || 0) * 1024 ** 3);
        await extractArchive(backupPath, restorePath, maxExpandedBytes);

        if (includesDatabase) {
            await runProcess('mariadb-dump', [
                '--skip-ssl',
                '-h', process.env.MARIADB_HOST || 'mariadb',
                '-u', 'root',
                `--result-file=${rollbackDbDump}`,
                s.db_name
            ], { env: mysqlEnv() });
            rollbackDatabaseAvailable = true;
        }

        await fs.rename(s.data_path, previousPath);
        originalMoved = true;
        await fs.rename(restorePath, s.data_path);
        filesSwapped = true;

        if (includesDatabase) {
          try {
            await fs.access(path.join(s.data_path, 'database_dump.sql'));
            await runProcess('mariadb', [
                '--skip-ssl',
                '-h', process.env.MARIADB_HOST || 'mariadb',
                '-u', 'root',
                '-e', `DROP DATABASE IF EXISTS \`${s.db_name}\`; CREATE DATABASE \`${s.db_name}\`;`
            ], { env: mysqlEnv() });
            await runProcess('mariadb', [
                '--skip-ssl',
                '-h', process.env.MARIADB_HOST || 'mariadb',
                '-u', 'root',
                s.db_name
            ], { env: mysqlEnv(), stdinFile: dbDumpFile });
            await fs.unlink(dbDumpFile);
          } catch (dbError) {
            throw new Error(`No se pudo restaurar la base de datos de ${s.id}: ${dbError.message}`);
          }
        }

        await controlServer(s.id, userId, 'start', isAdmin, { maintenanceResume: true });
        await fs.rm(previousPath, { recursive: true, force: true });
        await fs.unlink(rollbackDbDump).catch(() => {});
        await logAudit(userId, 'SERVER.BACKUP.RESTORE', { serverId: s.id, filename: safeFilename });
        return { success: true, message: 'Sistema restaurado con exito.' };
    } catch (err) {
        console.error('Fallo critico en la restauracion:', err);

        if (filesSwapped) {
            await fs.rm(s.data_path, { recursive: true, force: true }).catch(() => {});
            await fs.rename(previousPath, s.data_path).catch((rollbackError) => {
                console.error('Fallo al restaurar la carpeta anterior:', rollbackError);
            });
        } else if (originalMoved) {
            await fs.rename(previousPath, s.data_path).catch((rollbackError) => {
                console.error('Fallo al recolocar la carpeta original:', rollbackError);
            });
            await fs.rm(restorePath, { recursive: true, force: true }).catch(() => {});
        } else {
            await fs.rm(restorePath, { recursive: true, force: true }).catch(() => {});
        }

        if (includesDatabase && rollbackDatabaseAvailable) {
            try {
                await runProcess('mariadb', [
                    '--skip-ssl',
                    '-h', process.env.MARIADB_HOST || 'mariadb',
                    '-u', 'root',
                    '-e', `DROP DATABASE IF EXISTS \`${s.db_name}\`; CREATE DATABASE \`${s.db_name}\`;`
                ], { env: mysqlEnv() });
                await runProcess('mariadb', [
                    '--skip-ssl',
                    '-h', process.env.MARIADB_HOST || 'mariadb',
                    '-u', 'root',
                    s.db_name
                ], { env: mysqlEnv(), stdinFile: rollbackDbDump });
            } catch (rollbackError) {
                console.error('Fallo al restaurar la base de datos anterior:', rollbackError);
            }
        }

        await fs.unlink(rollbackDbDump).catch(() => {});
        await controlServer(s.id, userId, 'start', isAdmin, { maintenanceResume: true }).catch((restartError) => {
            console.error('Fallo al reanudar el servidor despues del rollback:', restartError);
        });
        throw new Error('No se pudo restaurar la copia de seguridad.');
    }
}

export async function deleteBackup(id, filename, userId, isAdmin) {
    const s = await getServerByIdForUser(id, userId, isAdmin, 'files');
    if (!s) throw new Error('Servidor no encontrado');

    const { safeFilename, backupPath } = getBackupPathForServer(s.id, filename);

    try {
        await fs.unlink(backupPath);
    } catch (e) {
        console.log('[Aviso] El backup ya no existe fisicamente.');
    }

    await logAudit(userId, 'SERVER.BACKUP.DELETE', { serverId: s.id, filename: safeFilename });
    return { success: true };
}

export async function migrateResources(oldServerId, newServerId, isAdmin) {
    if (!isAdmin) throw new Error('Solo el administrador puede migrar nodos.');

    const oldSrv = await getServerByIdForUser(oldServerId, null, true);
    const newSrv = await getServerByIdForUser(newServerId, null, true);

    if (!oldSrv || !newSrv) throw new Error('IDs de servidor no validos.');
    oldSrv.data_path = assertSafeDataPath(oldSrv.data_path);
    newSrv.data_path = assertSafeDataPath(newSrv.data_path);
    const migrateDatabase = hasManagedDatabase(oldSrv) && hasManagedDatabase(newSrv);
    if (migrateDatabase) {
        assertSafeDbName(oldSrv.db_name);
        assertSafeDbName(newSrv.db_name);
    }

    await controlServer(oldSrv.id, null, 'stop', true);
    await controlServer(newSrv.id, null, 'stop', true);

    const tmpDump = `/tmp/mig_${oldSrv.id}.sql`;

    try {
        await runProcess('rsync', [
            '-a',
            `${path.join(oldSrv.data_path, 'resources')}${path.sep}`,
            `${path.join(newSrv.data_path, 'resources')}${path.sep}`
        ]);

        await fs.copyFile(path.join(oldSrv.data_path, 'server.cfg'), path.join(newSrv.data_path, 'server.cfg'));

        if (migrateDatabase) {
            await runProcess('mariadb-dump', [
                '--skip-ssl',
                '-h', process.env.MARIADB_HOST || 'mariadb',
                '-u', 'root',
                `--result-file=${tmpDump}`,
                oldSrv.db_name
            ], { env: mysqlEnv() });

            await runProcess('mariadb', [
                '--skip-ssl',
                '-h', process.env.MARIADB_HOST || 'mariadb',
                '-u', 'root',
                newSrv.db_name
            ], { env: mysqlEnv(), stdinFile: tmpDump });
        }

        await fs.unlink(tmpDump).catch(() => {});
        await controlServer(newSrv.id, null, 'start', true);
        return { success: true, message: 'Recursos y BD migrados al nuevo contenedor.' };
    } catch (e) {
        await fs.unlink(tmpDump).catch(() => {});
        console.error('Error en migracion rsync/mysql:', e);
        throw new Error('Fallo en la transferencia de recursos.');
    }
}

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { config } from '../config.js';
import { getServerByIdForUser, controlServer } from './serverService.js';
import { rustUtil } from '../utils/rustUtil.js';
import { logAudit, query } from '../db.js';

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

async function emptyDirectory(dir) {
    const root = path.resolve(config.instanceDataRoot);
    const target = path.resolve(dir);

    if (!target.startsWith(`${root}${path.sep}`) || target.length < root.length + 2) {
        throw new Error('Ruta de datos invalida. Abortando limpieza.');
    }

    await fs.mkdir(target, { recursive: true });
    const entries = await fs.readdir(target, { withFileTypes: true });
    await Promise.all(entries.map((entry) => fs.rm(path.join(target, entry.name), { recursive: true, force: true })));
}

export async function syncBackupsToGDrive() {
    try {
        console.log('☁️ [GDrive] Iniciando sincronizacion de backups...');
        await runProcess('rclone', ['sync', config.backupRoot, 'gdrive:ragenodes_backups']);
        console.log('✅ [GDrive] Sincronizacion completada con exito.');
    } catch (e) {
        console.error('❌ [GDrive] Error en sincronizacion:', e.message);
    }
}

export async function createFullBackup(id, userId, isAdmin, customName = null) {
    const s = await getServerByIdForUser(id, userId, isAdmin, 'files');
    if (!s) throw new Error('Servidor no encontrado');
    assertSafeDbName(s.db_name);

    await fs.mkdir(config.backupRoot, { recursive: true });

    const shortId = s.id.slice(0, 8);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const nameTag = customName ? customName.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'manual';
    const backupFileName = `backup_${shortId}_${nameTag}_${timestamp}.tar.zst`;
    const backupFilePath = path.join(config.backupRoot, backupFileName);
    const dbDumpFile = path.join(s.data_path, 'database_dump.sql');

    try {
        await runProcess('mariadb-dump', [
            '--skip-ssl',
            '-h', 'mariadb',
            '-u', 'root',
            `--result-file=${dbDumpFile}`,
            s.db_name
        ], { env: mysqlEnv() });

        const compressResult = await rustUtil.zstd(s.data_path, backupFilePath);
        if (!compressResult.success) throw new Error(compressResult.error);

        await fs.unlink(dbDumpFile).catch(() => {});

        const stat = await fs.stat(backupFilePath);
        await query(
            `INSERT INTO backups (server_id, filename, size_bytes, created_at)
             VALUES ($1, $2, $3, now())`,
            [s.id, backupFileName, stat.size]
        );

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
        fs.unlink(dbDumpFile).catch(() => {});
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
                await query('DELETE FROM backups WHERE server_id = $1 AND filename = $2', [serverId, fileToDelete]);
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
    assertSafeDbName(s.db_name);

    const { safeFilename, backupPath } = getBackupPathForServer(s.id, filename);
    const dbDumpFile = path.join(s.data_path, 'database_dump.sql');

    await controlServer(s.id, userId, 'stop', isAdmin);

    try {
        await emptyDirectory(s.data_path);

        if (safeFilename.endsWith('.zst')) {
            await runProcess('tar', ['--use-compress-program=unzstd', '-xf', backupPath, '-C', s.data_path]);
        } else {
            await runProcess('tar', ['-xzf', backupPath, '-C', s.data_path]);
        }

        try {
            await fs.access(dbDumpFile);
            await runProcess('mariadb', [
                '--skip-ssl',
                '-h', 'mariadb',
                '-u', 'root',
                '-e', `DROP DATABASE IF EXISTS \`${s.db_name}\`; CREATE DATABASE \`${s.db_name}\`;`
            ], { env: mysqlEnv() });
            await runProcess('mariadb', [
                '--skip-ssl',
                '-h', 'mariadb',
                '-u', 'root',
                s.db_name
            ], { env: mysqlEnv(), stdinFile: dbDumpFile });
            await fs.unlink(dbDumpFile);
        } catch (dbError) {
            console.log(`[Backup Restore] No se encontro dump SQL o fallo importacion para ${s.id}: ${dbError.message}`);
        }

        await controlServer(s.id, userId, 'start', isAdmin);
        await logAudit(userId, 'SERVER.BACKUP.RESTORE', { serverId: s.id, filename: safeFilename });
        return { success: true, message: 'Sistema restaurado con exito.' };
    } catch (err) {
        console.error('Fallo critico en la restauracion:', err);
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
    assertSafeDbName(oldSrv.db_name);
    assertSafeDbName(newSrv.db_name);

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

        await runProcess('mariadb-dump', [
            '--skip-ssl',
            '-h', 'mariadb',
            '-u', 'root',
            `--result-file=${tmpDump}`,
            oldSrv.db_name
        ], { env: mysqlEnv() });

        await runProcess('mariadb', [
            '--skip-ssl',
            '-h', 'mariadb',
            '-u', 'root',
            newSrv.db_name
        ], { env: mysqlEnv(), stdinFile: tmpDump });

        await fs.unlink(tmpDump).catch(() => {});
        await controlServer(newSrv.id, null, 'start', true);
        return { success: true, message: 'Recursos y BD migrados al nuevo contenedor.' };
    } catch (e) {
        await fs.unlink(tmpDump).catch(() => {});
        console.error('Error en migracion rsync/mysql:', e);
        throw new Error('Fallo en la transferencia de recursos.');
    }
}

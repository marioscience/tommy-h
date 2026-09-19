import path from 'path';
import fs from 'fs/promises';
import { config } from '../config.js';
import { getServerByIdForUser } from './serverService.js';
import { logAudit } from '../db.js';
import { deleteBackupRecord, recordBackup } from '../repositories/backupRepository.js';
import { hasManagedDatabase } from './backupPolicy.js';
import { getNodeConnection } from './dockerUtils.js';
import { normalizeSharedDataPermissions } from './games/BaseGameService.js';
import { rustUtil } from '../utils/rustUtil.js';
import {
    assertSafeBackupDataPath,
    assertSafeBackupDatabaseName,
    backupDatabaseEnv,
    createBackupArchive,
    getBackupPathForServer,
    runBackupProcess
} from './backupArchiveService.js';

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
export async function createFullBackup(id, userId, isAdmin, customName = null) {
    const s = await getServerByIdForUser(id, userId, isAdmin, 'files');
    if (!s) throw new Error('Servidor no encontrado');
    s.data_path = assertSafeBackupDataPath(s.data_path);
    const includesDatabase = hasManagedDatabase(s);
    if (includesDatabase) assertSafeBackupDatabaseName(s.db_name);

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
            await runBackupProcess('mariadb-dump', [
                '--skip-ssl',
                '-h', process.env.MARIADB_HOST || 'mariadb',
                '-u', 'root',
                `--result-file=${dbDumpFile}`,
                s.db_name
            ], { env: backupDatabaseEnv() });
        }

        await createBackupArchive(s.data_path, backupFilePath);

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
    s.data_path = assertSafeBackupDataPath(s.data_path);

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

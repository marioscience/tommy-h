import path from 'path';
import fs from 'fs/promises';
import { config, PLAN_LIMITS } from '../config.js';
import { logAudit } from '../db.js';
import { getServerByIdForUser } from './serverService.js';
import { controlServer } from './serverControlService.js';
import { hasManagedDatabase } from './backupPolicy.js';
import {
  assertBackupIntegrity,
  assertSafeBackupDataPath,
  assertSafeBackupDatabaseName,
  backupDatabaseEnv,
  extractBackupArchive,
  getBackupPathForServer,
  runBackupProcess
} from './backupArchiveService.js';

async function replaceDatabaseFromDump(databaseName, dumpPath) {
  await runBackupProcess('mariadb', [
    '--skip-ssl', '-h', process.env.MARIADB_HOST || 'mariadb', '-u', 'root',
    '-e', `DROP DATABASE IF EXISTS \`${databaseName}\`; CREATE DATABASE \`${databaseName}\`;`
  ], { env: backupDatabaseEnv() });
  await runBackupProcess('mariadb', [
    '--skip-ssl', '-h', process.env.MARIADB_HOST || 'mariadb', '-u', 'root', databaseName
  ], { env: backupDatabaseEnv(), stdinFile: dumpPath });
}

async function rollbackFiles(server, state) {
  const { restorePath, previousPath, originalMoved, filesSwapped } = state;
  if (filesSwapped) {
    await fs.rm(server.data_path, { recursive: true, force: true }).catch(() => {});
    await fs.rename(previousPath, server.data_path).catch((error) => {
      console.error('Fallo al restaurar la carpeta anterior:', error);
    });
  } else if (originalMoved) {
    await fs.rename(previousPath, server.data_path).catch((error) => {
      console.error('Fallo al recolocar la carpeta original:', error);
    });
    await fs.rm(restorePath, { recursive: true, force: true }).catch(() => {});
  } else {
    await fs.rm(restorePath, { recursive: true, force: true }).catch(() => {});
  }
}

export async function restoreBackup(id, filename, userId, isAdmin) {
  const server = await getServerByIdForUser(id, userId, isAdmin, 'files');
  if (!server) throw new Error('Servidor no encontrado');
  server.data_path = assertSafeBackupDataPath(server.data_path);
  const includesDatabase = hasManagedDatabase(server);
  if (includesDatabase) assertSafeBackupDatabaseName(server.db_name);

  const { safeFilename, backupPath } = getBackupPathForServer(server.id, filename);
  const databaseDump = path.join(server.data_path, 'database_dump.sql');
  const restoreNonce = `${process.pid}-${Date.now()}`;
  const restorePath = `${server.data_path}.restore-${restoreNonce}`;
  const previousPath = `${server.data_path}.previous-${restoreNonce}`;
  const rollbackDatabaseDump = path.join(config.backupRoot, `.restore-db-${server.id}-${restoreNonce}.sql`);
  const state = { restorePath, previousPath, originalMoved: false, filesSwapped: false };
  let rollbackDatabaseAvailable = false;

  await controlServer(server.id, userId, 'stop', isAdmin);
  try {
    await assertBackupIntegrity(server.id, safeFilename, backupPath);
    await fs.mkdir(restorePath, { recursive: true });
    const plan = PLAN_LIMITS[String(server.runtime_plan || server.plan || 'hobby').toLowerCase()] || PLAN_LIMITS.hobby;
    const maxExpandedBytes = Number(plan.diskBytes) + (Number(server.extra_disk_gb || 0) * 1024 ** 3);
    await extractBackupArchive(backupPath, restorePath, maxExpandedBytes);

    if (includesDatabase) {
      await runBackupProcess('mariadb-dump', [
        '--skip-ssl', '-h', process.env.MARIADB_HOST || 'mariadb', '-u', 'root',
        `--result-file=${rollbackDatabaseDump}`, server.db_name
      ], { env: backupDatabaseEnv() });
      rollbackDatabaseAvailable = true;
    }

    await fs.rename(server.data_path, previousPath);
    state.originalMoved = true;
    await fs.rename(restorePath, server.data_path);
    state.filesSwapped = true;

    if (includesDatabase) {
      try {
        await fs.access(databaseDump);
        await replaceDatabaseFromDump(server.db_name, databaseDump);
        await fs.unlink(databaseDump);
      } catch (error) {
        throw new Error(`No se pudo restaurar la base de datos de ${server.id}: ${error.message}`);
      }
    }

    await controlServer(server.id, userId, 'start', isAdmin, { maintenanceResume: true });
    await fs.rm(previousPath, { recursive: true, force: true });
    await fs.unlink(rollbackDatabaseDump).catch(() => {});
    await logAudit(userId, 'SERVER.BACKUP.RESTORE', { serverId: server.id, filename: safeFilename });
    return { success: true, message: 'Sistema restaurado con exito.' };
  } catch (error) {
    console.error('Fallo critico en la restauracion:', error);
    await rollbackFiles(server, state);
    if (includesDatabase && rollbackDatabaseAvailable) {
      await replaceDatabaseFromDump(server.db_name, rollbackDatabaseDump).catch((rollbackError) => {
        console.error('Fallo al restaurar la base de datos anterior:', rollbackError);
      });
    }
    await fs.unlink(rollbackDatabaseDump).catch(() => {});
    await controlServer(server.id, userId, 'start', isAdmin, { maintenanceResume: true }).catch((restartError) => {
      console.error('Fallo al reanudar el servidor despues del rollback:', restartError);
    });
    throw new Error('No se pudo restaurar la copia de seguridad.');
  }
}

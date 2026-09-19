import path from 'path';
import fs from 'fs/promises';
import { getServerByIdForUser } from './serverService.js';
import { controlServer } from './serverControlService.js';
import { hasManagedDatabase } from './backupPolicy.js';
import {
  assertSafeBackupDataPath,
  assertSafeBackupDatabaseName,
  backupDatabaseEnv,
  runBackupProcess
} from './backupArchiveService.js';

export async function migrateResources(oldServerId, newServerId, isAdmin) {
  if (!isAdmin) throw new Error('Solo el administrador puede migrar nodos.');
  const oldServer = await getServerByIdForUser(oldServerId, null, true);
  const newServer = await getServerByIdForUser(newServerId, null, true);
  if (!oldServer || !newServer) throw new Error('IDs de servidor no validos.');

  oldServer.data_path = assertSafeBackupDataPath(oldServer.data_path);
  newServer.data_path = assertSafeBackupDataPath(newServer.data_path);
  const migrateDatabase = hasManagedDatabase(oldServer) && hasManagedDatabase(newServer);
  if (migrateDatabase) {
    assertSafeBackupDatabaseName(oldServer.db_name);
    assertSafeBackupDatabaseName(newServer.db_name);
  }

  await controlServer(oldServer.id, null, 'stop', true);
  await controlServer(newServer.id, null, 'stop', true);
  const temporaryDump = `/tmp/mig_${oldServer.id}.sql`;
  try {
    await runBackupProcess('rsync', [
      '-a', `${path.join(oldServer.data_path, 'resources')}${path.sep}`,
      `${path.join(newServer.data_path, 'resources')}${path.sep}`
    ]);
    await fs.copyFile(path.join(oldServer.data_path, 'server.cfg'), path.join(newServer.data_path, 'server.cfg'));

    if (migrateDatabase) {
      await runBackupProcess('mariadb-dump', [
        '--skip-ssl', '-h', process.env.MARIADB_HOST || 'mariadb', '-u', 'root',
        `--result-file=${temporaryDump}`, oldServer.db_name
      ], { env: backupDatabaseEnv() });
      await runBackupProcess('mariadb', [
        '--skip-ssl', '-h', process.env.MARIADB_HOST || 'mariadb', '-u', 'root', newServer.db_name
      ], { env: backupDatabaseEnv(), stdinFile: temporaryDump });
    }

    await fs.unlink(temporaryDump).catch(() => {});
    await controlServer(newServer.id, null, 'start', true);
    return { success: true, message: 'Recursos y BD migrados al nuevo contenedor.' };
  } catch (error) {
    await fs.unlink(temporaryDump).catch(() => {});
    console.error('Error en migracion rsync/mysql:', error);
    throw new Error('Fallo en la transferencia de recursos.');
  }
}

import fs from 'fs/promises';
import { config } from '../config.js';
import { runBackupProcess } from './backupArchiveService.js';

export async function syncBackupsToRemote() {
  if (!config.backupRemoteEnabled) return { success: true, skipped: true, reason: 'disabled' };

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
  await runBackupProcess('rclone', [
    '--config', config.rcloneConfigPath, 'sync', config.backupRoot, `${remoteName}:${remotePath}`
  ]);
  console.log('[BackupRemote] Sincronizacion completada.');
  return { success: true, skipped: false };
}

export const syncBackupsToGDrive = syncBackupsToRemote;

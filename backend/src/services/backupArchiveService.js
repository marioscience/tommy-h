import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { config } from '../config.js';
import { findBackupRecord } from '../repositories/backupRepository.js';
import { rustUtil } from '../utils/rustUtil.js';

const MAX_ERROR_LOG_BYTES = 1024 * 1024;

export function runBackupProcess(command, args = [], options = {}) {
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
      child.stdout.on('data', (data) => { stdout += data.toString(); });
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

export function backupDatabaseEnv() {
  return { MYSQL_PWD: config.centralDbPass || '' };
}

export function assertSafeBackupDatabaseName(dbName) {
  if (!dbName || !/^[a-zA-Z0-9_]+$/.test(dbName)) throw new Error('Nombre de base de datos invalido.');
}

export function assertSafeBackupDataPath(dataPath) {
  const root = path.resolve(config.instanceDataRoot);
  const target = path.resolve(String(dataPath || ''));
  if (!target.startsWith(`${root}${path.sep}`) || target.length < root.length + 2) {
    throw new Error('Ruta de datos invalida.');
  }
  return target;
}

export async function createBackupArchive(sourceDirectory, destination) {
  const partialPath = `${destination}.partial-${process.pid}-${Date.now()}`;
  try {
    if (config.backupArchiveEngine === 'rust' && rustUtil.runtimeInfo().nativeAvailable) {
      const result = await rustUtil.zstd(sourceDirectory, partialPath);
      if (!result.success) throw new Error(`Compresor Rust no disponible: ${result.error}`);
    } else {
      if (config.backupArchiveEngine === 'rust') {
        console.warn('[Backup] Rust solicitado pero el modulo nativo no esta disponible; usando tar de forma segura.');
      }
      await runBackupProcess('tar', ['--zstd', '-cf', partialPath, '-C', sourceDirectory, '.']);
    }
    await fs.rename(partialPath, destination);
  } catch (error) {
    await fs.unlink(partialPath).catch(() => {});
    throw error;
  }
}

export async function extractBackupArchive(source, destination, maxExpandedBytes) {
  if (source.endsWith('.zst') && config.backupArchiveEngine === 'rust' && rustUtil.runtimeInfo().nativeAvailable) {
    const result = await rustUtil.unzstd(source, destination, maxExpandedBytes);
    if (!result.success) throw new Error(`Extractor Rust no disponible: ${result.error}`);
    return;
  }
  await runBackupProcess('tar', source.endsWith('.zst')
    ? ['--zstd', '-xf', source, '-C', destination]
    : ['-xzf', source, '-C', destination]);
}

export async function assertBackupIntegrity(serverId, filename, backupPath) {
  const record = await findBackupRecord(serverId, filename);
  if (!record?.checksum_sha256) return { verified: false, reason: 'legacy-without-checksum' };
  const actual = await rustUtil.sha256File(backupPath);
  if (actual !== record.checksum_sha256) {
    throw new Error('La copia no supera la validacion SHA-256 y no sera restaurada.');
  }
  return { verified: true, checksumSha256: actual };
}

export function getBackupPathForServer(serverId, filename) {
  const shortId = serverId.slice(0, 8);
  const safeFilename = path.basename(filename || '');
  if (!safeFilename.startsWith(`backup_${shortId}_`) || !/\.tar\.(gz|zst)$/.test(safeFilename)) {
    throw new Error('Nombre de backup invalido para este servidor.');
  }
  const backupRoot = path.resolve(config.backupRoot);
  const backupPath = path.resolve(backupRoot, safeFilename);
  if (!backupPath.startsWith(`${backupRoot}${path.sep}`)) throw new Error('Ruta de backup invalida.');
  return { safeFilename, backupPath };
}

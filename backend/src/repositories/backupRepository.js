import { query } from '../db.js';

export async function recordBackup({ serverId, filename, sizeBytes, checksumSha256 = null }, db = query) {
  return db(
    `INSERT INTO backups (server_id, filename, size_bytes, checksum_sha256, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [serverId, filename, sizeBytes, checksumSha256]
  );
}

export async function findBackupRecord(serverId, filename, db = query) {
  const { rows } = await db(
    'SELECT filename, size_bytes, checksum_sha256 FROM backups WHERE server_id = $1 AND filename = $2 LIMIT 1',
    [serverId, filename]
  );
  return rows[0] || null;
}

export async function deleteBackupRecord(serverId, filename, db = query) {
  return db('DELETE FROM backups WHERE server_id = $1 AND filename = $2', [serverId, filename]);
}

import { query } from '../db.js';

export async function recordBackup({ serverId, filename, sizeBytes }, db = query) {
  return db(
    `INSERT INTO backups (server_id, filename, size_bytes, created_at)
     VALUES ($1, $2, $3, now())`,
    [serverId, filename, sizeBytes]
  );
}

export async function deleteBackupRecord(serverId, filename, db = query) {
  return db('DELETE FROM backups WHERE server_id = $1 AND filename = $2', [serverId, filename]);
}

import { query } from '../db.js';

export async function listAdminNotifications(db = query) {
  return (await db('SELECT * FROM notifications ORDER BY created_at DESC')).rows;
}

export async function listClientNotifications(limit = 5, db = query) {
  return (await db(
    `SELECT * FROM notifications
     WHERE audience IN ('client', 'all')
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  )).rows;
}

export async function createNotification({ title, content, type = 'info', audience = 'client' }, db = query) {
  if (!['admin', 'client', 'all'].includes(audience)) {
    throw new Error('INVALID_NOTIFICATION_AUDIENCE');
  }
  return db(
    'INSERT INTO notifications (title, content, type, audience) VALUES ($1, $2, $3, $4)',
    [title, content, type, audience]
  );
}

export async function deleteNotification(notificationId, db = query) {
  return db('DELETE FROM notifications WHERE id = $1', [notificationId]);
}

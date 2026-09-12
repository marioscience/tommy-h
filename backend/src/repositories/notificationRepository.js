import { query } from '../db.js';

export async function listAdminNotifications(db = query) {
  return (await db('SELECT * FROM notifications ORDER BY created_at DESC')).rows;
}

export async function listClientNotifications(limit = 5, db = query) {
  return (await db(
    `SELECT * FROM notifications
     WHERE title NOT LIKE '%[Staging]%'
       AND title NOT LIKE '%[ROLLBACK%'
       AND title NOT LIKE '%Despliegue%'
       AND title NOT LIKE '%[Deploy%'
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  )).rows;
}

export async function createNotification({ title, content, type = 'info' }, db = query) {
  return db(
    'INSERT INTO notifications (title, content, type) VALUES ($1, $2, $3)',
    [title, content, type]
  );
}

export async function deleteNotification(notificationId, db = query) {
  return db('DELETE FROM notifications WHERE id = $1', [notificationId]);
}

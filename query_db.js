import { query } from './backend/src/db.js';
query('SELECT id, name, expires_at FROM servers;').then(res => { console.log(res.rows); process.exit(0); }).catch(err => { console.error(err); process.exit(1); });

import { query } from './db.js';

async function reset() {
  const envPassHash = '$2a$10$Jt45Lvd5Orneyl9XkkomE.Ux6i2I0Fco6TDOq1TysPIZFb98If0ji'; // 4f8c2a7d9b1e6f3c5a0d7b2e8c4f1a9
  const shortPassHash = '$2a$10$lxu6dBaXl.o//puX.7GeW..Wzlkvt4EEzQA/8cmSAXcIduNxngCne'; // admin

  await query('UPDATE users SET password_hash = $1 WHERE username = $2', [envPassHash, 'admin']);
  console.log('Updated admin password to match .env ADMIN_BOOTSTRAP_PASS!');
  process.exit(0);
}

reset().catch(console.error);

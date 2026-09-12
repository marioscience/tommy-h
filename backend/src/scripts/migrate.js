#!/usr/bin/env node
import 'dotenv/config';
import { query, withTransaction, waitForDb, pool } from '../db.js';
import { runMigrations, migrations } from '../migrations.js';

async function main() {
  console.log('====================================================');
  console.log('🐘 RageNodes Database Migration Runner');
  console.log('====================================================');

  try {
    console.log('[Runner] Conectando con PostgreSQL...');
    await waitForDb();
    console.log('[Runner] Conectado exitosamente.');
    console.log(`[Runner] Total de migraciones registradas: ${migrations.length}`);

    const applied = await runMigrations(query, withTransaction);
    console.log('====================================================');
    console.log(`✅ Proceso finalizado. Migraciones ejecutadas: ${applied}`);
    console.log('====================================================');
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fatal ejecutando migraciones:', error);
    await pool.end();
    process.exit(1);
  }
}

main();

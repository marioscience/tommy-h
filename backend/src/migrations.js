/**
 * 🗄️ RageNodes Versioned Database Migrations System
 * 
 * Reglas para desarrolladores:
 * 1. Cada migración debe tener un `id` con timestamp UTC (ej. YYYYMMDDHHMM_nombre_descriptivo).
 * 2. Las sentencias deben ser idempotentes (usar IF NOT EXISTS / ON CONFLICT).
 * 3. Nunca modificar una migración que ya fue aplicada en producción. Agregar una nueva migración al final.
 */

import { migrations } from './migrations/migrationStatements.js';

export { migrations };

export async function runMigrations(query, withTransaction) {
  // 1. Asegurar tabla de control de versiones
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  let appliedCount = 0;

  // 2. Ejecutar cada migración dentro de una transacción atómica protegida
  for (const migration of migrations) {
    const existing = await query('SELECT id FROM schema_migrations WHERE id = $1', [migration.id]);
    if (existing.rowCount > 0) continue;

    console.log(`[DB Migration] 🚀 Aplicando migración: ${migration.id}...`);
    try {
      await withTransaction(async (tx) => {
        for (const statement of migration.statements) {
          await tx(statement);
        }
        await tx('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
      });
      appliedCount++;
      console.log(`[DB Migration] ✅ Migración ${migration.id} aplicada con éxito.`);
    } catch (error) {
      if (migration.optional) {
        console.warn(`[DB Migration] ⚠️ Migración opcional ${migration.id} omitida: ${error.message}`);
        await query('INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING', [migration.id]);
        continue;
      }
      console.error(`[DB Migration] ❌ Error fatal en migración ${migration.id}:`, error.message);
      throw error;
    }
  }

  if (appliedCount === 0) {
    console.log(`[DB Migration] ✨ Base de datos al día. No hay migraciones pendientes.`);
  } else {
    console.log(`[DB Migration] 🎉 Se aplicaron ${appliedCount} migraciones con éxito.`);
  }
  return appliedCount;
}

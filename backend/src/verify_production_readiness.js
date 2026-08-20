import { query } from '../src/db.js';

async function verifyProductionReadiness() {
  console.log('🛡️  ======================================================');
  console.log('🛡️  RAGENODES PRODUCTION READINESS & MIGRATION VERIFIER');
  console.log('🛡️  ======================================================\n');

  let passed = true;

  // 1. Verificar Tablas Obligatorias en PostgreSQL
  const requiredTables = [
    'users',
    'servers',
    'payments',
    'invite_keys',
    'nodes',
    'edge_proxies',
    'disk_plans',
    'audit_logs',
    'schema_migrations'
  ];

  console.log('🔍 [1/3] Verificando esquema de tablas en PostgreSQL...');
  for (const table of requiredTables) {
    try {
      const res = await query(`SELECT COUNT(*) FROM ${table}`);
      console.log(`   ✅ Tabla '${table}': Existe (${res.rows[0].count} registros)`);
    } catch (e) {
      console.error(`   ❌ TABLA CRÍTICA FALTANTE: '${table}' -> ${e.message}`);
      passed = false;
    }
  }

  // 2. Verificar Estado de Migraciones Aplicadas
  console.log('\n🔍 [2/3] Verificando historial de migraciones...');
  try {
    const res = await query('SELECT id, applied_at FROM schema_migrations ORDER BY applied_at ASC');
    console.log(`   ✅ Migraciones aplicadas: ${res.rowCount}`);
    res.rows.forEach(m => console.log(`      - ${m.id} (${new Date(m.applied_at).toISOString()})`));
  } catch (e) {
    console.error(`   ❌ Error al consultar schema_migrations: ${e.message}`);
    passed = false;
  }

  // 3. Verificación de Semillas Iniciales (Seed Data)
  console.log('\n🔍 [3/3] Verificando packs de almacenamiento iniciales...');
  try {
    const res = await query('SELECT id, name, price FROM disk_plans WHERE is_active = true');
    if (res.rowCount >= 4) {
      console.log(`   ✅ Packs de disco activos: ${res.rowCount} packs listos.`);
    } else {
      console.warn(`   ⚠️ Advertencia: Solo hay ${res.rowCount} packs de disco activos.`);
    }
  } catch (e) {
    console.error(`   ❌ Error al consultar disk_plans: ${e.message}`);
    passed = false;
  }

  console.log('\n------------------------------------------------------');
  if (passed) {
    console.log('🎉 RESULTADO: PRODUCCIÓN 100% VERIFICADA Y LISTA PARA DESPLIEGUE.');
    process.exit(0);
  } else {
    console.error('🚨 RESULTADO: SE DETECTARON ERRORES CRÍTICOS DE ESQUEMA. DESPLIEGUE ABORTADO.');
    process.exit(1);
  }
}

verifyProductionReadiness().catch(err => {
  console.error('❌ Error fatal en la verificación de producción:', err);
  process.exit(1);
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrations, runMigrations } from '../src/migrations.js';

describe('🗄️ Database Migrations System Tests', () => {
    it('debería tener identificadores de migración únicos y con formato cronológico', () => {
        const seenIds = new Set();
        const idRegex = /^\d{12}_[a-z0-9_]+$/;

        for (const m of migrations) {
            assert.ok(m.id, 'Cada migración debe tener un id');
            assert.ok(idRegex.test(m.id), `El id "${m.id}" debe seguir el formato YYYYMMDDHHMM_nombre`);
            assert.ok(!seenIds.has(m.id), `El id "${m.id}" no debe estar duplicado`);
            seenIds.add(m.id);
        }
    });

    it('cada migración debe contener un array de sentencias SQL no vacías', () => {
        for (const m of migrations) {
            assert.ok(Array.isArray(m.statements), `Migración ${m.id} debe tener un array de statements`);
            assert.ok(m.statements.length > 0, `Migración ${m.id} debe contener al menos un statement`);
            for (const stmt of m.statements) {
                assert.equal(typeof stmt, 'string');
                assert.ok(stmt.trim().length > 0, `Statement en ${m.id} no debe estar vacío`);
            }
        }
    });

    it('declara la tabla histórica requerida por el recolector de métricas', () => {
        const schemaSql = migrations.flatMap((migration) => migration.statements).join('\n');
        assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS server_stats_history\s*\(/i);
        assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS notifications\s*\(/i);
        assert.match(schemaSql, /server_id UUID NOT NULL REFERENCES servers\(id\) ON DELETE CASCADE/i);
        assert.match(schemaSql, /idx_server_stats_history_server_time/i);
    });

    it('debería registrar y aplicar migraciones pendientes usando mock de DB', async () => {
        const appliedDbMigrations = new Set(['202601010001_initial_core_schema']);
        const executedStatements = [];

        const mockQuery = async (text, params = []) => {
            if (text.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
                return { rows: [] };
            }
            if (text.includes('SELECT id FROM schema_migrations')) {
                const id = params[0];
                return { rowCount: appliedDbMigrations.has(id) ? 1 : 0, rows: appliedDbMigrations.has(id) ? [{ id }] : [] };
            }
            if (text.includes('INSERT INTO schema_migrations')) {
                appliedDbMigrations.add(params[0]);
                return { rowCount: 1 };
            }
            executedStatements.push(text);
            return { rowCount: 1 };
        };

        const mockWithTransaction = async (callback) => {
            const txQuery = async (text, params = []) => {
                if (text.includes('INSERT INTO schema_migrations')) {
                    appliedDbMigrations.add(params[0]);
                    return { rowCount: 1 };
                }
                executedStatements.push(text);
                return { rowCount: 1 };
            };
            return callback(txQuery);
        };

        const applied = await runMigrations(mockQuery, mockWithTransaction);
        assert.equal(applied, migrations.length - 1, 'Debe haber aplicado todas las migraciones excepto la primera ya aplicada');
        assert.ok(appliedDbMigrations.has(migrations[migrations.length - 1].id), 'La última migración debe quedar registrada');
    });

    it('debería omitir la ejecución si todas las migraciones ya están aplicadas', async () => {
        const mockQuery = async (text, params = []) => {
            if (text.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) return { rows: [] };
            if (text.includes('SELECT id FROM schema_migrations')) return { rowCount: 1, rows: [{ id: params[0] }] };
            return { rowCount: 0 };
        };
        const mockWithTransaction = async () => {};

        const applied = await runMigrations(mockQuery, mockWithTransaction);
        assert.equal(applied, 0, 'No debe aplicar ninguna si ya están al día');
    });
});

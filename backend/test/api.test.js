import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { rustUtil } from '../src/utils/rustUtil.js';

describe('🦀 RustBridge & Stats Calculator Tests (Módulo 1 & 3)', () => {
    it('debería identificar explícitamente el motor cargado', () => {
        const runtime = rustUtil.runtimeInfo();
        assert.ok(['rust-native', 'javascript-fallback'].includes(runtime.engine));
        assert.equal(runtime.nativeAvailable, runtime.engine === 'rust-native');
    });

    it('debería calcular estadísticas de Docker correctamente vía Rust o Fallback JS', async () => {
        const mockStats = {
            cpu_stats: { cpu_usage: { total_usage: 100000 }, system_cpu_usage: 500000, online_cpus: 4 },
            precpu_stats: { cpu_usage: { total_usage: 80000 }, system_cpu_usage: 400000, online_cpus: 4 },
            memory_stats: { usage: 2048000, limit: 4096000, stats: { inactive_file: 0 } }
        };

        const result = await rustUtil.calculateStats(mockStats);
        assert.ok(result, 'El resultado no debería ser nulo');
        assert.equal(typeof result.cpu, 'string');
        assert.equal(typeof result.ram, 'string');
        assert.ok(result.cpu.includes('%'), 'El porcentaje de CPU debe contener %');
        assert.ok(result.ram.includes('%'), 'El porcentaje de RAM debe contener %');
    });

    it('debería manejar payloads vacíos o corruptos sin lanzar excepciones', async () => {
        const resultNull = await rustUtil.calculateStats(null);
        assert.equal(resultNull, null);

        const resultEmpty = await rustUtil.calculateStats({});
        assert.ok(resultEmpty !== undefined);
    });

    it('mantiene el contrato al calcular telemetría por lotes', async () => {
        const sample = {
            cpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 1000, online_cpus: 2 },
            precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 500 },
            memory_stats: { usage: 1024, limit: 2048, stats: { inactive_file: 0 } }
        };
        const results = await rustUtil.calculateStatsBatch([sample, sample]);
        assert.equal(results.length, 2);
        assert.deepEqual(results[0], results[1]);
        assert.equal(results[0].cpu, '40.00%');
        assert.equal(results[0].ram, '50.00%');
        assert.equal(results[0].net_rx, '0');
        assert.equal(results[0].net_tx, '0');
    });

    it('calcula SHA-256 por streaming también en el fallback', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ragenodes-hash-'));
        const file = path.join(directory, 'sample.bin');
        try {
            await fs.writeFile(file, 'ragenodes');
            assert.equal(await rustUtil.sha256File(file), '703e3c5ca81fad04b9dd5b2aa919c5c1452cde9992dc932ef23128ad118371fd');
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });
});

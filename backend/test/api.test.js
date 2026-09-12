import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
});

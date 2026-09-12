import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateContainerUsage } from '../src/services/discordDiagnosticsService.js';

describe('Discord diagnostics telemetry', () => {
  it('calculates CPU and memory without changing the public numeric units', () => {
    const usage = calculateContainerUsage({
      cpu_stats: {
        cpu_usage: { total_usage: 300 },
        system_cpu_usage: 2_000,
        online_cpus: 4
      },
      precpu_stats: {
        cpu_usage: { total_usage: 200 },
        system_cpu_usage: 1_000
      },
      memory_stats: {
        usage: 600,
        limit: 1_000,
        stats: { cache: 100 }
      }
    });

    assert.deepEqual(usage, { cpuPercent: 40, ramPercent: 50 });
  });

  it('returns finite zero values when Docker reports empty deltas', () => {
    const usage = calculateContainerUsage({
      cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0, online_cpus: 2 },
      precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
      memory_stats: { usage: 0, limit: 0, stats: {} }
    });

    assert.deepEqual(usage, { cpuPercent: 0, ramPercent: 0 });
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assessRuntimeProcessRisk } from '../src/services/runtimeAnomalyMonitor.js';

const thresholds = { alert: 512, stop: 4096 };

describe('runtime anomaly policy', () => {
  it('marks an unregistered container as orphan without stopping it', () => {
    assert.deepEqual(assessRuntimeProcessRisk(12, false, thresholds), {
      level: 'orphan',
      processCount: 12
    });
  });

  it('warns before the process count can exhaust the host', () => {
    assert.deepEqual(assessRuntimeProcessRisk(800, true, thresholds), {
      level: 'warning',
      processCount: 800
    });
  });

  it('stops both managed and orphan containers at the critical threshold', () => {
    assert.equal(assessRuntimeProcessRisk(4096, true, thresholds).level, 'critical');
    assert.equal(assessRuntimeProcessRisk(125163, false, thresholds).level, 'critical');
  });

  it('keeps ordinary registered game containers untouched', () => {
    assert.deepEqual(assessRuntimeProcessRisk(64, true, thresholds), {
      level: 'normal',
      processCount: 64
    });
  });
});


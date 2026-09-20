import test from 'node:test';
import assert from 'node:assert/strict';
import { decideScale } from './backend_autoscaler.mjs';

const config = {
  minReplicas: 2, maxReplicas: 4, upCpuPercent: 65, upP95Ms: 300, upEventLoopMs: 100, upErrorRate: 0.02,
  downCpuPercent: 25, downP95Ms: 100, downRpsPerReplica: 15,
  upSamples: 2, downSamples: 3, upCooldownSeconds: 180, downCooldownSeconds: 600
};
const loaded = { current: 2, cpuAverage: 80, cpuMax: 95, p95Ms: 400, eventLoopP99Ms: 120, requestsPerSecond: 300, errorRate: 0 };
const idle = { current: 3, cpuAverage: 10, cpuMax: 15, p95Ms: 50, eventLoopP99Ms: 5, requestsPerSecond: 9 };

test('requires sustained load and observes cooldown before scaling up', () => {
  const first = decideScale(loaded, { lastScaleAt: 0 }, config, 1_000_000);
  assert.equal(first.desired, 2);
  const second = decideScale(loaded, first.state, config, 1_001_000);
  assert.equal(second.desired, 3);
  assert.equal(second.reason, 'sustained-load');
  const duringCooldown = decideScale({ ...loaded, current: 3 }, second.state, config, 1_010_000);
  assert.equal(duringCooldown.desired, 3);
});

test('scales down only after a longer sustained idle period', () => {
  let state = { lastScaleAt: 0 };
  let decision;
  for (let index = 0; index < 3; index += 1) {
    decision = decideScale(idle, state, config, 1_000_000 + index * 30_000);
    state = decision.state;
  }
  assert.equal(decision.desired, 2);
  assert.equal(decision.reason, 'sustained-idle');
});

test('enforces bounds immediately', () => {
  assert.equal(decideScale({ ...idle, current: 1 }, {}, config).desired, 2);
  assert.equal(decideScale({ ...loaded, current: 7 }, {}, config).desired, 4);
});

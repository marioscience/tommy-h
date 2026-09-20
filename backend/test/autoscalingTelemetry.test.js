import test from 'node:test';
import assert from 'node:assert/strict';
import { getAutoscalingTelemetry, isLoopbackAddress, recordRequest } from '../src/services/autoscalingTelemetry.js';

test('autoscaling telemetry reports bounded percentiles and error rate', () => {
  const now = 1_800_000_000_000;
  recordRequest(8, 200, now);
  recordRequest(180, 200, now);
  recordRequest(700, 503, now);
  const telemetry = getAutoscalingTelemetry(now);
  assert.equal(telemetry.requests, 3);
  assert.equal(telemetry.errors_5xx, 1);
  assert.equal(telemetry.error_rate, 0.3333);
  assert.equal(telemetry.requests_per_second, 0.6);
  assert.equal(telemetry.latency_p95_ms, 800);
  assert.equal(telemetry.latency_p99_ms, 800);
});

test('internal autoscaling endpoint accepts only loopback addresses', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('172.20.0.5'), false);
  assert.equal(isLoopbackAddress('203.0.113.10'), false);
});

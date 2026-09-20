import { monitorEventLoopDelay } from 'node:perf_hooks';

const WINDOW_SECONDS = 60;
const BUCKET_SECONDS = 5;
const BUCKET_COUNT = WINDOW_SECONDS / BUCKET_SECONDS;
const LATENCY_BOUNDS_MS = [10, 25, 50, 100, 200, 400, 800, 1600, 3200, Infinity];

const buckets = Array.from({ length: BUCKET_COUNT }, emptyBucket);
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();
let firstRecordedAtMs = null;

function emptyBucket(epoch = -1) {
  return { epoch, requests: 0, errors: 0, latency: Array(LATENCY_BOUNDS_MS.length).fill(0) };
}

function activeBucket(nowMs = Date.now()) {
  const epoch = Math.floor(nowMs / (BUCKET_SECONDS * 1000));
  const index = epoch % BUCKET_COUNT;
  if (buckets[index].epoch !== epoch) buckets[index] = emptyBucket(epoch);
  return buckets[index];
}

export function recordRequest(durationMs, statusCode, nowMs = Date.now()) {
  if (firstRecordedAtMs === null || nowMs < firstRecordedAtMs) firstRecordedAtMs = nowMs;
  const bucket = activeBucket(nowMs);
  bucket.requests += 1;
  if (statusCode >= 500) bucket.errors += 1;
  const index = LATENCY_BOUNDS_MS.findIndex(bound => durationMs <= bound);
  bucket.latency[index < 0 ? bucket.latency.length - 1 : index] += 1;
}

function percentile(counts, total, percentileValue) {
  if (!total) return 0;
  const target = Math.ceil(total * percentileValue);
  let seen = 0;
  for (let index = 0; index < counts.length; index += 1) {
    seen += counts[index];
    if (seen >= target) {
      const bound = LATENCY_BOUNDS_MS[index];
      return Number.isFinite(bound) ? bound : LATENCY_BOUNDS_MS[index - 1] * 2;
    }
  }
  return 0;
}

export function getAutoscalingTelemetry(nowMs = Date.now()) {
  const currentEpoch = Math.floor(nowMs / (BUCKET_SECONDS * 1000));
  const aggregate = emptyBucket();
  for (const bucket of buckets) {
    if (bucket.epoch < currentEpoch - BUCKET_COUNT + 1 || bucket.epoch > currentEpoch) continue;
    aggregate.requests += bucket.requests;
    aggregate.errors += bucket.errors;
    bucket.latency.forEach((count, index) => { aggregate.latency[index] += count; });
  }
  const observedSeconds = firstRecordedAtMs === null
    ? WINDOW_SECONDS
    : Math.min(WINDOW_SECONDS, Math.max(BUCKET_SECONDS, (nowMs - firstRecordedAtMs) / 1000));
  const eventLoopP99Ms = Number((eventLoop.percentile(99) / 1e6).toFixed(2));
  eventLoop.reset();
  return {
    window_seconds: WINDOW_SECONDS,
    requests: aggregate.requests,
    requests_per_second: Number((aggregate.requests / observedSeconds).toFixed(2)),
    errors_5xx: aggregate.errors,
    error_rate: aggregate.requests ? Number((aggregate.errors / aggregate.requests).toFixed(4)) : 0,
    latency_p95_ms: percentile(aggregate.latency, aggregate.requests, 0.95),
    latency_p99_ms: percentile(aggregate.latency, aggregate.requests, 0.99),
    event_loop_p99_ms: eventLoopP99Ms
  };
}

export function autoscalingTelemetryMiddleware(req, res, next) {
  if (req.path === '/healthz' || req.path === '/readyz' || req.path === '/internal/autoscaling') return next();
  const started = process.hrtime.bigint();
  res.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    recordRequest(durationMs, res.statusCode);
  });
  next();
}

export function isLoopbackAddress(address) {
  const normalized = String(address || '').toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1';
}

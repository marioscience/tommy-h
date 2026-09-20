#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULTS = Object.freeze({
  minReplicas: 2,
  maxReplicas: 4,
  upCpuPercent: 65,
  upP95Ms: 300,
  upEventLoopMs: 100,
  upErrorRate: 0.02,
  downCpuPercent: 25,
  downP95Ms: 100,
  downRpsPerReplica: 15,
  upSamples: 2,
  downSamples: 10,
  upCooldownSeconds: 180,
  downCooldownSeconds: 600
});

const numberFromEnv = (name, fallback) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const integerFromEnv = (name, fallback, minimum = 1) => Math.max(minimum, Math.floor(numberFromEnv(name, fallback)));

export function autoscalingConfig() {
  return {
    minReplicas: integerFromEnv('BACKEND_AUTOSCALE_MIN', DEFAULTS.minReplicas),
    maxReplicas: integerFromEnv('BACKEND_AUTOSCALE_MAX', DEFAULTS.maxReplicas),
    upCpuPercent: numberFromEnv('BACKEND_AUTOSCALE_UP_CPU_PERCENT', DEFAULTS.upCpuPercent),
    upP95Ms: numberFromEnv('BACKEND_AUTOSCALE_UP_P95_MS', DEFAULTS.upP95Ms),
    upEventLoopMs: numberFromEnv('BACKEND_AUTOSCALE_UP_EVENT_LOOP_MS', DEFAULTS.upEventLoopMs),
    upErrorRate: numberFromEnv('BACKEND_AUTOSCALE_UP_ERROR_RATE', DEFAULTS.upErrorRate),
    downCpuPercent: numberFromEnv('BACKEND_AUTOSCALE_DOWN_CPU_PERCENT', DEFAULTS.downCpuPercent),
    downP95Ms: numberFromEnv('BACKEND_AUTOSCALE_DOWN_P95_MS', DEFAULTS.downP95Ms),
    downRpsPerReplica: numberFromEnv('BACKEND_AUTOSCALE_DOWN_RPS_PER_REPLICA', DEFAULTS.downRpsPerReplica),
    upSamples: integerFromEnv('BACKEND_AUTOSCALE_UP_SAMPLES', DEFAULTS.upSamples),
    downSamples: integerFromEnv('BACKEND_AUTOSCALE_DOWN_SAMPLES', DEFAULTS.downSamples),
    upCooldownSeconds: numberFromEnv('BACKEND_AUTOSCALE_UP_COOLDOWN_SECONDS', DEFAULTS.upCooldownSeconds),
    downCooldownSeconds: numberFromEnv('BACKEND_AUTOSCALE_DOWN_COOLDOWN_SECONDS', DEFAULTS.downCooldownSeconds)
  };
}

export function decideScale({ current, cpuAverage, cpuMax, p95Ms, eventLoopP99Ms, requestsPerSecond, errorRate = 0 }, previous = {}, config = DEFAULTS, nowMs = Date.now()) {
  if (config.minReplicas > config.maxReplicas) throw new Error('BACKEND_AUTOSCALE_MIN no puede superar BACKEND_AUTOSCALE_MAX');
  const state = {
    upSignals: Number(previous.upSignals || 0),
    downSignals: Number(previous.downSignals || 0),
    lastScaleAt: Number(previous.lastScaleAt || 0)
  };
  const scaleUpSignal = cpuAverage >= config.upCpuPercent
    || cpuMax >= config.upCpuPercent + 15
    || p95Ms >= config.upP95Ms
    || eventLoopP99Ms >= config.upEventLoopMs
    || (errorRate >= config.upErrorRate && requestsPerSecond >= 50 && cpuAverage >= config.downCpuPercent);
  const scaleDownSignal = cpuAverage <= config.downCpuPercent
    && cpuMax <= config.downCpuPercent + 10
    && p95Ms <= config.downP95Ms
    && requestsPerSecond / Math.max(current, 1) <= config.downRpsPerReplica;

  state.upSignals = scaleUpSignal ? state.upSignals + 1 : 0;
  state.downSignals = scaleDownSignal ? state.downSignals + 1 : 0;
  const elapsedSeconds = (nowMs - state.lastScaleAt) / 1000;
  let desired = current;
  let reason = 'stable';

  if (current < config.minReplicas) {
    desired = config.minReplicas;
    reason = 'below-minimum';
  } else if (current > config.maxReplicas) {
    desired = config.maxReplicas;
    reason = 'above-maximum';
  } else if (current < config.maxReplicas && state.upSignals >= config.upSamples && elapsedSeconds >= config.upCooldownSeconds) {
    desired = current + 1;
    reason = 'sustained-load';
  } else if (current > config.minReplicas && state.downSignals >= config.downSamples && elapsedSeconds >= config.downCooldownSeconds) {
    desired = current - 1;
    reason = 'sustained-idle';
  }

  if (desired !== current) {
    state.lastScaleAt = nowMs;
    state.upSignals = 0;
    state.downSignals = 0;
  }
  return { desired, reason, state, scaleUpSignal, scaleDownSignal };
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

function backendContainerIds(project) {
  return run('docker', ['ps', '--filter', `label=com.docker.compose.project=${project}`, '--filter', 'label=com.docker.compose.service=backend', '--format', '{{.ID}}'])
    .split(/\s+/).filter(Boolean);
}

function containerCpu(ids) {
  if (!ids.length) return [];
  const output = run('docker', ['stats', '--no-stream', '--format', '{{json .}}', ...ids]);
  return output.split('\n').filter(Boolean).map(line => Number(JSON.parse(line).CPUPerc.replace('%', '')) || 0);
}

function containerTelemetry(id, includeDetails = false) {
  const suffix = includeDetails ? '?details=1' : '';
  const program = `fetch('http://127.0.0.1:3006/internal/autoscaling${suffix}').then(async r=>{if(!r.ok)throw new Error(String(r.status));process.stdout.write(await r.text())}).catch(e=>{console.error(e);process.exit(1)})`;
  return JSON.parse(run('docker', ['exec', id, 'node', '-e', program]));
}

function aggregateTelemetry(items) {
  const sum = key => items.reduce((total, item) => total + Number(item[key] || 0), 0);
  return {
    requestsPerSecond: sum('requests_per_second'),
    p95Ms: Math.max(0, ...items.map(item => Number(item.latency_p95_ms || 0))),
    p99Ms: Math.max(0, ...items.map(item => Number(item.latency_p99_ms || 0))),
    eventLoopP99Ms: Math.max(0, ...items.map(item => Number(item.event_loop_p99_ms || 0))),
    errorRate: sum('requests') ? sum('errors_5xx') / sum('requests') : 0,
    databaseWaiting: items.reduce((max, item) => Math.max(max, Number(item.database_pool?.waiting || 0)), 0),
    queueDepth: Math.max(0, ...items.flatMap(item => item.deployment_queue || []).map(row => Number(row.queue_depth || 0)))
  };
}

function composeInvocation(firstContainer, projectDir, project) {
  const labels = JSON.parse(run('docker', ['inspect', '--format', '{{json .Config.Labels}}', firstContainer]));
  const files = String(labels['com.docker.compose.project.config_files'] || path.join(projectDir, 'docker-compose.yml'))
    .split(',').filter(Boolean);
  const args = ['compose', '-p', project];
  for (const file of files) args.push('-f', file);
  for (const envFile of ['.env', 'deploy/registry-release.lock']) {
    const absolute = path.join(projectDir, envFile);
    if (fs.existsSync(absolute)) args.push('--env-file', absolute);
  }
  return args;
}

function readState(statePath) {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return {}; }
}

function writeState(statePath, value) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o750 });
  const temporary = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, statePath);
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function waitForHealthyReplicas(project, desired, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ids = backendContainerIds(project);
    if (ids.length === desired) {
      const healthy = ids.every(id => {
        const state = run('docker', ['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', id]);
        return state === 'healthy' || state === 'running';
      });
      if (healthy) return;
    }
    sleep(2_000);
  }
  throw new Error(`Las ${desired} réplicas backend no alcanzaron estado saludable antes del timeout`);
}

function acquireLock(statePath) {
  const lockPath = `${statePath}.lock`;
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o750 });
  try {
    fs.mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
    if (ageMs < 5 * 60 * 1000) return null;
    fs.rmdirSync(lockPath);
    fs.mkdirSync(lockPath, { mode: 0o700 });
  }
  return () => fs.rmdirSync(lockPath);
}

export function runAutoscaler() {
  if (!/^(true|1)$/i.test(process.env.BACKEND_AUTOSCALE_ENABLED || 'false')) {
    console.log(JSON.stringify({ status: 'disabled' }));
    return;
  }
  const projectDir = path.resolve(process.env.RAGENODES_PROJECT_DIR || process.cwd());
  const project = process.env.COMPOSE_PROJECT_NAME || 'ragenodesultimate';
  const statePath = process.env.BACKEND_AUTOSCALE_STATE_PATH || '/var/lib/ragenodes-autoscaler/state.json';
  const releaseLock = acquireLock(statePath);
  if (!releaseLock) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'evaluation-already-running' }));
    return;
  }
  try {
    const ids = backendContainerIds(project);
    if (!ids.length) throw new Error(`No hay réplicas backend activas en ${project}`);
    const cpu = containerCpu(ids);
    const telemetry = aggregateTelemetry(ids.map((id, index) => containerTelemetry(id, index === 0)));
    const signals = {
      current: ids.length,
      cpuAverage: cpu.reduce((a, b) => a + b, 0) / Math.max(cpu.length, 1),
      cpuMax: Math.max(0, ...cpu),
      ...telemetry
    };
    const config = autoscalingConfig();
    const result = decideScale(signals, readState(statePath), config);
    const report = { timestamp: new Date().toISOString(), signals, decision: result.reason, desired: result.desired };

    if (result.desired !== ids.length) {
      const composeArgs = composeInvocation(ids[0], projectDir, project);
      run('docker', [...composeArgs, 'up', '-d', '--no-deps', '--no-recreate', '--scale', `backend=${result.desired}`, 'backend'], { cwd: projectDir });
      waitForHealthyReplicas(project, result.desired);
    }
    writeState(statePath, { ...result.state, lastReport: report });
    console.log(JSON.stringify(report));
  } finally {
    releaseLock();
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try { runAutoscaler(); } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}

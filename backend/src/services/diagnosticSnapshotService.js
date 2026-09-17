import os from 'os';
import { runCommand } from './diagnosticProbeService.js';

function filterLines(text, ports) {
  const patterns = [
    ...ports.map(String),
    'limit', 'hashlimit', 'recent', 'connlimit',
    'DROP', 'REJECT', 'drop', 'reject', 'meter'
  ];
  return String(text || '')
    .split('\n')
    .filter((line) => patterns.some((pattern) => line.includes(pattern)))
    .join('\n');
}

export async function getDockerPs() {
  return runCommand('docker', ['ps', '--format', 'table {{.Names}}\t{{.Status}}\t{{.Ports}}']);
}

export async function getDockerPortMap(containerNames = []) {
  const results = [];
  for (const name of containerNames) {
    if (!/^[-_.a-zA-Z0-9]+$/.test(name)) continue;
    results.push({ container: name, ...await runCommand('docker', ['port', name]) });
  }
  return results;
}

export function getDockerContainersFromPsOutput(stdout) {
  const lines = String(stdout || '').split('\n').slice(1);
  const containers = [];
  for (const line of lines) {
    const name = line.trim().split(/\s+/)[0];
    if (
      name
      && !name.includes('ultimate')
      && !name.includes('master')
      && !name.includes('panel')
      && !containers.includes(name)
    ) {
      containers.push(name);
    }
  }
  return containers;
}

export async function getUdpListenersInsideContainers(containerNames = [], ports = []) {
  const results = [];
  for (const name of containerNames) {
    if (!/^[-_.a-zA-Z0-9]+$/.test(name)) continue;
    const portRegex = ports.join('|');
    const result = await runCommand('docker', [
      'exec',
      name,
      'sh',
      '-lc',
      `ss -lunp 2>/dev/null | grep -E "(${portRegex})" || netstat -lunp 2>/dev/null | grep -E "(${portRegex})" || echo "UDP no visible dentro"`
    ]);
    results.push({ container: name, ...result });
  }
  return results;
}

export async function getFirewallSnapshot(ports) {
  const [iptables, nft] = await Promise.all([
    runCommand('iptables-save', []),
    runCommand('nft', ['list', 'ruleset'])
  ]);
  return {
    iptables: {
      ok: iptables.ok,
      cmd: iptables.cmd,
      durationMs: iptables.durationMs,
      output: filterLines(`${iptables.stdout}\n${iptables.stderr}`, ports)
    },
    nftables: {
      ok: nft.ok,
      cmd: nft.cmd,
      durationMs: nft.durationMs,
      output: filterLines(`${nft.stdout}\n${nft.stderr}`, ports)
    }
  };
}

export async function getNetworkSnapshot() {
  const [ipAddr, ipRoute, ssTcp, ssUdp] = await Promise.all([
    runCommand('ip', ['addr']),
    runCommand('ip', ['route']),
    runCommand('ss', ['-lntp']),
    runCommand('ss', ['-lunp'])
  ]);
  return { ipAddr, ipRoute, ssTcp, ssUdp };
}

export async function getSystemSnapshot() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const [df, free, uptime] = await Promise.all([
    runCommand('df', ['-h']),
    runCommand('free', ['-h']),
    runCommand('uptime', [])
  ]);
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptimeSeconds: os.uptime(),
    loadavg: os.loadavg(),
    cpuCount: os.cpus()?.length || 0,
    memory: {
      totalBytes: totalMem,
      freeBytes: freeMem,
      usedBytes: totalMem - freeMem,
      usedPct: Number((((totalMem - freeMem) / totalMem) * 100).toFixed(2))
    },
    commands: { df, free, uptime }
  };
}

export function summarizePortProbe(port, localInfo, publicInfo, localDynamic, publicDynamic) {
  let status = 'ok';
  const warnings = [];
  if (!publicInfo?.ok) {
    status = 'critical';
    warnings.push('info.json (Público) OFF');
  }
  if (!publicDynamic?.ok) {
    status = status === 'critical' ? status : 'warning';
    warnings.push('dynamic.json (Público) OFF');
  }
  if ((!localInfo?.ok || !localDynamic?.ok) && publicInfo?.ok) {
    warnings.push('Localhost OFF (Normal en aislamiento Docker)');
  }
  return {
    port,
    status,
    hostname: publicDynamic?.parsed?.hostname
      || localDynamic?.parsed?.hostname
      || publicInfo?.parsed?.vars?.sv_projectName
      || localInfo?.parsed?.vars?.sv_projectName
      || null,
    clients: publicDynamic?.parsed?.clients ?? localDynamic?.parsed?.clients ?? null,
    maxClients: publicDynamic?.parsed?.sv_maxclients
      ?? localDynamic?.parsed?.sv_maxclients
      ?? publicInfo?.parsed?.vars?.sv_maxClients
      ?? localInfo?.parsed?.vars?.sv_maxClients
      ?? null,
    checks: { localInfo, publicInfo, localDynamic, publicDynamic },
    warnings
  };
}

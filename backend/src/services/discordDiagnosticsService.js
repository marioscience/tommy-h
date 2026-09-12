import Docker from 'dockerode';
import { config } from '../config.js';
import { query } from '../db.js';

const docker = new Docker({ socketPath: config.dockerSocket });

export function calculateContainerUsage(stats) {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage
    - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage
    - stats.precpu_stats.system_cpu_usage;
  const cpuPercent = systemDelta > 0 && cpuDelta > 0
    ? (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100
    : 0;

  const cache = stats.memory_stats.stats?.cache || 0;
  const usedMemory = stats.memory_stats.usage - cache;
  const ramPercent = stats.memory_stats.limit > 0
    ? (usedMemory / stats.memory_stats.limit) * 100
    : 0;

  return { cpuPercent, ramPercent };
}

async function getServerTelemetry(server) {
  let status = server.status;
  let cpuPercent = 0;
  let ramPercent = 0;

  try {
    if (server.container_name) {
      const container = docker.getContainer(server.container_name);
      const inspect = await container.inspect();
      status = inspect.State.Running ? 'running' : 'stopped';
      if (status === 'running') {
        ({ cpuPercent, ramPercent } = calculateContainerUsage(
          await container.stats({ stream: false })
        ));
      }
    }
  } catch {
    // A telemetry failure for one container must not hide the user's other
    // servers. The persisted status and zeroed metrics are the safe fallback.
    console.warn(`No se pudo leer la telemetría del servidor ${server.name}`);
  }

  return {
    id: server.id,
    name: server.name,
    status,
    ip: config.fivemPublicHost,
    fivem_port: server.fivem_port,
    cpu_percent: Number(cpuPercent.toFixed(1)),
    ram_percent: Number(ramPercent.toFixed(1)),
    disk_percent: 0
  };
}

/** Returns the stable payload consumed by the Discord diagnostic command. */
export async function getDiscordUserDiagnostics(discordId) {
  const userResult = await query(
    'SELECT id, username, plan FROM users WHERE discord_id = $1 LIMIT 1',
    [discordId]
  );
  if (userResult.rows.length === 0) return null;

  const user = userResult.rows[0];
  const serversResult = await query(
    'SELECT id, name, container_name, fivem_port, status FROM servers WHERE owner_id = $1',
    [user.id]
  );

  const servers = [];
  // Keep Docker calls sequential: a user with many servers must not create an
  // unbounded burst against the daemon merely by invoking a bot command.
  for (const server of serversResult.rows) {
    servers.push(await getServerTelemetry(server));
  }

  return {
    username: user.username,
    plan: user.plan || 'Hobby',
    servers
  };
}

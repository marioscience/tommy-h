import * as Docker from './dockerService.js';
import { buildRestartOptions } from './serverRestartOptions.js';

async function resolveFiveMLicenseKey(server) {
  try {
    const inspect = await Docker.inspectContainer(server.container_name);
    const value = (inspect.Config.Env || []).find((entry) => entry.startsWith('LICENSE_KEY='));
    return value ? value.slice('LICENSE_KEY='.length) : 'hidden';
  } catch {
    return 'hidden';
  }
}

/** Recreates one container; callers own state transitions and audit logging. */
export async function restartServerContainer(server, plan) {
  const licenseKey = server.template === 'fivem'
    ? await resolveFiveMLicenseKey(server)
    : 'hidden';
  const options = buildRestartOptions(server, plan, licenseKey);

  switch (server.template) {
    case 'minecraft': return Docker.restartMinecraftContainer(options);
    case 'rust': return Docker.restartRustContainer(options);
    case 'palworld': return Docker.restartPalworldContainer(options);
    case 'cs2': return Docker.restartCS2Container(options);
    case 'valheim': return Docker.restartValheimContainer(options);
    case 'zomboid': return Docker.restartZomboidContainer(options);
    case 'ark': return Docker.restartARKContainer(options);
    case 'sdtd': return Docker.restartSDTDContainer(
      server.container_name, server.id, server.fivem_port, plan, server.data_path
    );
    case 'discord':
    case 'discordbot': return Docker.restartDiscordBotContainer(options);
    case 'wordpress': return Docker.restartWordPressContainer(options);
    case 'database': return Docker.restartDatabaseContainer(options);
    case 'fivem': return Docker.restartFivemContainer(options);
    default: throw new Error(`Plantilla desconocida: ${server.template}`);
  }
}

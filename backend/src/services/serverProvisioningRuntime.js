import * as Docker from './dockerService.js';
import { GameFactory } from './games/GameFactory.js';
import { purgeServerDataDirectory } from './serverDataCleanup.js';
import { removeGameDatabase } from './gameDatabaseService.js';
import { deleteServerRecord } from '../repositories/serverRepository.js';

export async function removeContainerForPortRetry(nodeId, containerName) {
  try {
    const docker = await Docker.getNodeConnection(nodeId);
    await docker.getContainer(containerName).remove({ force: true });
  } catch (error) {
    if (error?.statusCode !== 404) throw error;
  }
}

export async function createGameContainer(template, options) {
  if (GameFactory.has(template)) return GameFactory.create(template, options);

  switch (template) {
    case 'palworld': return Docker.createPalworldContainer(options);
    case 'cs2': return Docker.createCS2Container(options);
    case 'valheim': return Docker.createValheimContainer(options);
    case 'zomboid': return Docker.createProjectZomboidContainer(options);
    case 'ark': return Docker.createARKContainer(options);
    case 'sdtd':
      return Docker.createSDTDContainer(
        options.containerName,
        options.serverId,
        options.gamePort,
        options.plan,
        options.dataPath,
        options.nodeId
      );
    case 'discordbot': return Docker.createDiscordBotContainer(options);
    case 'wordpress': return Docker.createWordPressContainer(options);
    case 'database': return Docker.createDatabaseContainer(options);
    default: throw new Error(`Tipo de servidor no soportado: ${template}.`);
  }
}

export async function rollbackServerCreation({ serverId, containerName, dataPath, nodeId, dbName, dbUser }) {
  for (const target of [containerName, `${containerName}-db`]) {
    try {
      const docker = await Docker.getNodeConnection(nodeId);
      await docker.getContainer(target).remove({ force: true });
    } catch (error) {
      if (error?.statusCode !== 404) console.warn(`[Rollback] No se pudo retirar ${target}: ${error.message}`);
    }
  }

  try {
    await purgeServerDataDirectory(nodeId, serverId, dataPath);
  } catch (error) {
    console.warn(`[Rollback] No se pudo retirar ${dataPath}: ${error.message}`);
  }

  if (dbName && dbUser) {
    try {
      await removeGameDatabase(dbName, dbUser);
    } catch (error) {
      console.warn(`[Rollback] No se pudo retirar la base de datos ${dbName}: ${error.message}`);
    }
  }

  try {
    await deleteServerRecord(serverId);
  } catch (error) {
    console.warn(`[Rollback] No se pudo retirar el registro ${serverId}: ${error.message}`);
  }
}

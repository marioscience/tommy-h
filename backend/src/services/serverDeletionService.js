import * as Docker from './dockerService.js';
import { blenderActivity, getServerByIdForUser, repairBackoffCache } from './serverService.js';
import { purgeServerDataDirectory } from './serverDataCleanup.js';
import { deleteServerRecord, updateServerStatus } from '../repositories/serverRepository.js';

export async function deleteServer(id, userId, isAdmin) {
  const server = await getServerByIdForUser(id, userId, isAdmin);
  if (!server) throw new Error('No encontrado');
  if (!isAdmin && server.owner_id !== userId) throw new Error('Solo el propietario puede eliminar el servidor.');

  await updateServerStatus(server.id, 'deleting');
  await Docker.removeContainer(server.container_name);
  await Docker.removeContainer(`${server.container_name}-db`);
  await Docker.removeContainer(`ragenodes-blender-${server.id.slice(0, 8)}`);
  await purgeServerDataDirectory(server.node_id, server.id, server.data_path);
  await deleteServerRecord(server.id);

  repairBackoffCache.delete(server.id);
  blenderActivity.delete(server.id);
  return { success: true };
}

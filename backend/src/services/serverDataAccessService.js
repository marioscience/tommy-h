import { config } from '../config.js';
import { getNodeConnection, normalizeBindAccess } from './dockerUtils.js';

const permissionCodes = new Set(['EACCES', 'EPERM']);

export function isDataPermissionError(error) {
  return permissionCodes.has(error?.code)
    || /permission denied|operation not permitted/i.test(String(error?.message || ''));
}

/**
 * Normaliza el volumen desde el mismo daemon que ejecuta el juego. Esto evita
 * depender de los UID mapeados del host en instalaciones Docker rootless.
 */
export async function ensureServerDataAccess(server, scope = 'files') {
  if (!server?.container_name || !server?.data_path) {
    throw new Error('El servidor no tiene un volumen de datos administrable.');
  }

  const docker = await getNodeConnection(server.node_id || 0);
  const container = docker.getContainer(server.container_name);
  const inspection = await container.inspect();
  const image = inspection?.Config?.Image;
  if (!image) throw new Error('No se pudo determinar la imagen del servidor.');
  await normalizeBindAccess(
    docker,
    image,
    server.data_path,
    config.gameContainerSharedGid,
    scope
  );
}

export async function withServerDataAccess(server, operation, scope = 'files') {
  try {
    return await operation();
  } catch (error) {
    if (!isDataPermissionError(error)) throw error;
    await ensureServerDataAccess(server, scope);
    return operation();
  }
}

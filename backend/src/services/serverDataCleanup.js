import crypto from 'crypto';
import path from 'path';
import { config } from '../config.js';
import { getNodeConnection } from './dockerUtils.js';

const CLEANUP_IMAGE = 'alpine:3.22.1@sha256:4bcff63911fcb4448bd4fdacec207030997caf25e9bea4045fa6c8c44de311d1';
const SERVER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Deletion is intentionally limited to one direct UUID child of the configured
 * instance root. This prevents a corrupted database row from turning cleanup
 * into an arbitrary host-path deletion.
 */
export function resolveSafeServerDataPath(dataRoot, serverId, dataPath) {
  if (!SERVER_ID_PATTERN.test(String(serverId))) {
    throw new Error('Server data cleanup rejected an invalid server id.');
  }

  const resolvedRoot = path.posix.resolve(String(dataRoot));
  const resolvedPath = path.posix.resolve(String(dataPath));
  const expectedPath = path.posix.join(resolvedRoot, String(serverId));

  if (resolvedRoot === '/' || resolvedPath !== expectedPath) {
    throw new Error('Server data cleanup rejected a path outside the instance root.');
  }

  return { dataRoot: resolvedRoot, dataPath: resolvedPath };
}

async function ensureCleanupImage(docker, image) {
  try {
    await docker.getImage(image).inspect();
  } catch {
    const stream = await docker.pull(image);
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(stream, (error, result) => error ? reject(error) : resolve(result));
    });
  }
}

/**
 * Uses the target node's Docker user namespace to remove files created by game
 * containers. The helper has no network and receives only the configured
 * instance root as a bind mount. DAC_OVERRIDE/FOWNER are restricted to the
 * helper's user namespace and are required to traverse files owned by the
 * different service UIDs used by WordPress, MariaDB and game images.
 */
export async function removeServerDataWithDocker({
  docker,
  dataRoot,
  serverId,
  dataPath,
  image = CLEANUP_IMAGE
}) {
  const safe = resolveSafeServerDataPath(dataRoot, serverId, dataPath);
  await ensureCleanupImage(docker, image);

  const helperName = `ragenodes-data-cleanup-${String(serverId).slice(0, 8)}-${crypto.randomBytes(4).toString('hex')}`;
  let helper;
  try {
    helper = await docker.createContainer({
      Image: image,
      name: helperName,
      User: '0:0',
      Entrypoint: ['/bin/rm'],
      Cmd: ['-rf', '--', `/instances/${serverId}`],
      HostConfig: {
        Binds: [`${safe.dataRoot}:/instances:rw`],
        NetworkMode: 'none',
        ReadonlyRootfs: true,
        ...(config.nodeEnv === 'production' ? {
          CapDrop: ['ALL'],
          CapAdd: ['DAC_OVERRIDE', 'FOWNER'],
          SecurityOpt: ['no-new-privileges:true']
        } : {})
      }
    });
    await helper.start();
    const result = await helper.wait();
    if (Number(result?.StatusCode) !== 0) {
      throw new Error(`Server data cleanup exited with code ${result?.StatusCode}.`);
    }
  } finally {
    if (helper) await helper.remove({ force: true }).catch(() => {});
  }
}

export async function purgeServerDataDirectory(nodeId, serverId, dataPath) {
  const docker = await getNodeConnection(nodeId || 0);
  await removeServerDataWithDocker({
    docker,
    dataRoot: config.instanceDataRoot,
    serverId,
    dataPath
  });
}

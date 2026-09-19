import { config } from '../config.js';
import { getNodeConnection } from './dockerNodeService.js';

export async function toggleBlender(opts, action) {
  const docker = await getNodeConnection(opts.nodeId || 0);
  const shortId = opts.serverId.slice(0, 8);
  const containerName = `ragenodes-blender-${shortId}`;

  if (action === 'stop') {
    try {
      const container = docker.getContainer(containerName);
      await container.stop({ t: 5 });
      await container.remove({ force: true });
    } catch {}
    return { success: true };
  }

  try {
    const existing = docker.getContainer(containerName);
    await existing.stop({ t: 2 }).catch(() => {});
    await existing.remove({ force: true }).catch(() => {});
  } catch {}

  try {
    const container = await docker.createContainer({
      Image: config.blenderBaseImage,
      name: containerName,
      Env: [
        `PASSWORD=${opts.blenderPass}`,
        `SUBFOLDER=/blender/${shortId}/`,
        `TITLE=RageNodes 3D - ${shortId.toUpperCase()}`
      ],
      ExposedPorts: { '3000/tcp': {} },
      NetworkingConfig: { EndpointsConfig: { [config.dockerNetwork]: {} } },
      HostConfig: {
        Binds: [`${opts.dataPath}:/config/workspace`],
        PortBindings: { '3000/tcp': [{ HostIp: '0.0.0.0', HostPort: String(opts.blenderPort) }] },
        RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
        Memory: 4 * 1024 * 1024 * 1024,
        NanoCpus: 2 * 10 ** 9,
        CpuShares: 2048,
        BlkioWeight: config.dockerBlkioWeight,
        ShmSize: 1024 * 1024 * 1024,
        SecurityOpt: ['no-new-privileges:true']
      }
    });
    await container.start();
    return { success: true };
  } catch (error) {
    console.error(`[Blender] Error starting ${containerName}:`, error.message);
    throw error;
  }
}

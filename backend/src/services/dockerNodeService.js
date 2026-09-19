import Docker from 'dockerode';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { PassThrough } from 'stream';
import { config } from '../config.js';
import { findNodeById } from '../repositories/nodeRepository.js';

const execAsync = util.promisify(exec);
const REMOTE_HELPER_IMAGE = 'alpine@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b';

export const localDocker = new Docker({ socketPath: config.dockerSocket });
export const NODE_CONNECTIONS = new Map();

export async function getNodeConnection(nodeId = 0) {
  if (nodeId === 0 || nodeId === '0') return localDocker;
  if (NODE_CONNECTIONS.has(nodeId)) return NODE_CONNECTIONS.get(nodeId);

  try {
    const node = await findNodeById(nodeId);
    if (!node) throw new Error(`Nodo ${nodeId} no encontrado.`);
    const certsDir = path.join(config.projectRoot, 'certs');
    const dockerOptions = { host: node.ip_address, port: 2376 };
    try {
      const [ca, cert, key] = await Promise.all([
        fs.readFile(path.join(certsDir, 'ca', 'ca.pem')),
        fs.readFile(path.join(certsDir, 'nodes', String(nodeId), 'cert.pem')),
        fs.readFile(path.join(certsDir, 'nodes', String(nodeId), 'key.pem'))
      ]);
      Object.assign(dockerOptions, { protocol: 'https', ca, cert, key });
      console.log(`🔒 [Docker] Conexión cifrada (mTLS) establecida con Nodo #${nodeId}`);
    } catch {
      if (!config.allowInsecureDockerNodes || config.nodeEnv === 'production') {
        throw new Error(`Nodo #${nodeId} rechazado: faltan certificados mTLS válidos.`);
      }
      Object.assign(dockerOptions, { protocol: 'http', port: 2375 });
      console.warn(`⚠️ [Docker] Nodo #${nodeId} usa HTTP sin cifrar por excepción exclusiva de desarrollo.`);
    }
    const docker = new Docker(dockerOptions);
    NODE_CONNECTIONS.set(nodeId, docker);
    return docker;
  } catch (error) {
    console.error(`❌ [Docker] Error conectando al nodo ${nodeId}:`, error.message);
    throw error;
  }
}

export async function runRemoteCommand(nodeId, command) {
  if (!nodeId || nodeId == 0 || nodeId == '0') return execAsync(command);
  try {
    const docker = await getNodeConnection(nodeId);
    try {
      await docker.getImage(REMOTE_HELPER_IMAGE).inspect();
    } catch {
      console.log(`[Docker] Pulling alpine on node ${nodeId}...`);
      const stream = await docker.pull(REMOTE_HELPER_IMAGE);
      await new Promise((resolve, reject) => {
        docker.modem.followProgress(stream, (error, result) => error ? reject(error) : resolve(result));
      });
    }
    const container = await docker.createContainer({
      Image: REMOTE_HELPER_IMAGE,
      Cmd: ['sh', '-c', command],
      HostConfig: { Binds: ['/srv/ragenodes-data:/srv/ragenodes-data'], AutoRemove: true }
    });
    const attached = await container.attach({ stream: true, stdout: true, stderr: true });
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    const stdoutChunks = [];
    const stderrChunks = [];
    stdoutStream.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    stderrStream.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
    docker.modem.demuxStream(attached, stdoutStream, stderrStream);
    await container.start();
    const result = await container.wait();
    attached.destroy();
    stdoutStream.end();
    stderrStream.end();
    const stdout = Buffer.concat(stdoutChunks).toString('utf8');
    const stderr = Buffer.concat(stderrChunks).toString('utf8');
    if (result.StatusCode !== 0) {
      const detail = stderr.trim() || stdout.trim() || `exit ${result.StatusCode}`;
      throw new Error(`Comando remoto falló (${result.StatusCode}): ${detail}`);
    }
    return { stdout, stderr };
  } catch (error) {
    console.error(`[NodeHostCmd] Error on node ${nodeId}:`, error.message);
    throw error;
  }
}

export function commandStdout(result) {
  if (typeof result === 'string') return result;
  return result && typeof result.stdout === 'string' ? result.stdout : '';
}

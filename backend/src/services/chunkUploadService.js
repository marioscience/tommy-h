import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import path from 'path';

const DEFAULT_UPLOAD_ROOT = '/tmp/ragenodes_uploads';
const UPLOAD_ID_PATTERN = /^upload_\d+_[a-z0-9]+$/i;
const MAX_CHUNKS = 10000;

function assertUploadId(uploadId) {
  if (!UPLOAD_ID_PATTERN.test(String(uploadId || '')) || String(uploadId).length > 80) {
    throw new Error('Identificador de subida inválido.');
  }
  return String(uploadId);
}

function manifestPath(root, uploadId) {
  return path.join(root, `${assertUploadId(uploadId)}.owner.json`);
}

export function getChunkPath(uploadId, chunkIndex, root = DEFAULT_UPLOAD_ROOT) {
  const index = Number(chunkIndex);
  if (!Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) {
    throw new Error('Índice de fragmento inválido.');
  }
  return path.join(root, `${assertUploadId(uploadId)}.part${index}`);
}

async function readOwner(uploadId, root) {
  const payload = JSON.parse(await fs.readFile(manifestPath(root, uploadId), 'utf8'));
  if (!Number.isSafeInteger(payload.userId) && typeof payload.userId !== 'string') {
    throw new Error('Propietario de subida inválido.');
  }
  return String(payload.userId);
}

async function claimUpload(uploadId, userId, root) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const ownerPath = manifestPath(root, uploadId);
  let handle;
  try {
    handle = await fs.open(ownerPath, 'wx', 0o600);
    await handle.writeFile(JSON.stringify({ userId: String(userId), createdAt: new Date().toISOString() }));
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    await handle?.close();
  }
  if (await readOwner(uploadId, root) !== String(userId)) {
    throw new Error('Esta subida pertenece a otra sesión.');
  }
}

export async function storeUploadChunk({ temporaryPath, uploadId, chunkIndex, userId, root = DEFAULT_UPLOAD_ROOT }) {
  await claimUpload(uploadId, userId, root);
  const destination = getChunkPath(uploadId, chunkIndex, root);
  try {
    await fs.copyFile(temporaryPath, destination, fsConstants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('El fragmento ya fue recibido.');
    throw error;
  } finally {
    await fs.unlink(temporaryPath).catch(() => {});
  }
  return destination;
}

export async function validateChunkUpload({ uploadId, totalChunks, totalSize, userId, root = DEFAULT_UPLOAD_ROOT }) {
  if (await readOwner(uploadId, root) !== String(userId)) {
    throw new Error('Esta subida pertenece a otra sesión.');
  }
  const expectedChunks = Number(totalChunks);
  const expectedBytes = Number(totalSize);
  if (!Number.isInteger(expectedChunks) || expectedChunks < 1 || expectedChunks > MAX_CHUNKS) {
    throw new Error('Cantidad de fragmentos inválida.');
  }
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1) {
    throw new Error('Tamaño total inválido.');
  }
  const chunkPaths = [];
  let actualBytes = 0;
  for (let index = 0; index < expectedChunks; index += 1) {
    const chunkPath = getChunkPath(uploadId, index, root);
    const stat = await fs.stat(chunkPath);
    if (!stat.isFile()) throw new Error(`El fragmento ${index} no es un archivo.`);
    actualBytes += stat.size;
    chunkPaths.push(chunkPath);
  }
  if (actualBytes !== expectedBytes) throw new Error('El tamaño de la subida no coincide con sus fragmentos.');
  return chunkPaths;
}

export async function cleanupChunkUpload(uploadId, totalChunks, options = {}) {
  const root = options.root || DEFAULT_UPLOAD_ROOT;
  if (options.userId !== undefined) {
    const owner = await readOwner(uploadId, root);
    if (owner !== String(options.userId)) throw new Error('Esta subida pertenece a otra sesión.');
  }
  const count = Math.min(Math.max(Number(totalChunks) || 0, 0), MAX_CHUNKS);
  await Promise.all(Array.from({ length: count }, (_, index) =>
    fs.unlink(getChunkPath(uploadId, index, root)).catch(() => {})
  ));
  await fs.unlink(manifestPath(root, uploadId)).catch(() => {});
}

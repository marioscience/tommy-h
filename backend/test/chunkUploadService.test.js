import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  cleanupChunkUpload,
  storeUploadChunk,
  validateChunkUpload
} from '../src/services/chunkUploadService.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ragenodes-chunks-'));
  return {
    root,
    async chunk(name, content) {
      const file = path.join(root, name);
      await fs.writeFile(file, content);
      return file;
    }
  };
}

describe('chunk upload ownership', () => {
  it('binds every chunk to the user that claimed the upload id', async () => {
    const test = await fixture();
    const uploadId = 'upload_12345_owner';
    await storeUploadChunk({
      temporaryPath: await test.chunk('first.tmp', 'abc'), uploadId, chunkIndex: 0, userId: 7, root: test.root
    });
    await assert.rejects(
      storeUploadChunk({
        temporaryPath: await test.chunk('second.tmp', 'def'), uploadId, chunkIndex: 1, userId: 8, root: test.root
      }),
      /otra sesión/
    );
    await cleanupChunkUpload(uploadId, 2, { root: test.root, userId: 7 });
    await fs.rm(test.root, { recursive: true, force: true });
  });

  it('rejects incomplete or size-mismatched manifests before assembly', async () => {
    const test = await fixture();
    const uploadId = 'upload_12345_size';
    await storeUploadChunk({
      temporaryPath: await test.chunk('first.tmp', 'abc'), uploadId, chunkIndex: 0, userId: 7, root: test.root
    });
    await assert.rejects(
      validateChunkUpload({ uploadId, totalChunks: 1, totalSize: 4, userId: 7, root: test.root }),
      /tamaño/
    );
    await assert.rejects(
      validateChunkUpload({ uploadId, totalChunks: 2, totalSize: 3, userId: 7, root: test.root }),
      /ENOENT/
    );
    await cleanupChunkUpload(uploadId, 2, { root: test.root, userId: 7 });
    await fs.rm(test.root, { recursive: true, force: true });
  });

  it('accepts a complete upload owned by the caller', async () => {
    const test = await fixture();
    const uploadId = 'upload_12345_valid';
    await storeUploadChunk({
      temporaryPath: await test.chunk('zero.tmp', 'abc'), uploadId, chunkIndex: 0, userId: '9', root: test.root
    });
    await storeUploadChunk({
      temporaryPath: await test.chunk('one.tmp', 'de'), uploadId, chunkIndex: 1, userId: '9', root: test.root
    });
    const chunks = await validateChunkUpload({ uploadId, totalChunks: 2, totalSize: 5, userId: '9', root: test.root });
    assert.equal(chunks.length, 2);
    await cleanupChunkUpload(uploadId, 2, { root: test.root, userId: '9' });
    await fs.rm(test.root, { recursive: true, force: true });
  });
});

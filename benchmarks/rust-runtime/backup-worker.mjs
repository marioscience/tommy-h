import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { rustUtil } from '../../backend/src/utils/rustUtil.js';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], shell: false });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${command} (${code}): ${stderr.slice(0, 500)}`)));
  });
}

async function prepare(target, sizeMiB, profile) {
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
  const block = Buffer.alloc(1024 * 1024);
  for (let index = 0; index < sizeMiB; index += 1) {
    if (profile === 'mixed') {
      let offset = 0;
      while (offset < block.length) {
        const digest = crypto.createHash('sha256').update(`${index}:${offset}`).digest();
        digest.copy(block, offset);
        offset += digest.length;
      }
    } else {
      block.fill(index % 251);
    }
    const directory = path.join(target, `region-${index % 32}`);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, `chunk-${index}.bin`), block);
  }
}

async function digestTree(root) {
  const hash = crypto.createHash('sha256');
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
      hash.update(`${entry.isDirectory() ? 'd' : 'f'}:${relative}\0`);
      if (entry.isDirectory()) await visit(absolute);
      else hash.update(await fs.readFile(absolute));
    }
  }
  await visit(root);
  return hash.digest('hex');
}

const [operation, source, output, extra] = process.argv.slice(2);
if (operation === 'prepare') {
  await prepare(source, Number(output), extra || 'compressible');
} else if (operation === 'digest') {
  process.stdout.write(`${await digestTree(source)}\n`);
} else if (operation === 'tar') {
  await run('tar', ['--zstd', '-cf', output, '-C', source, '.']);
} else if (operation === 'rust') {
  const runtime = rustUtil.runtimeInfo();
  if (!runtime.nativeAvailable) throw new Error(`Rust nativo obligatorio para el benchmark; motor=${runtime.engine}`);
  const result = await rustUtil.zstd(source, output);
  if (!result.success) throw new Error(result.error);
} else {
  throw new Error('Uso: backup-worker.mjs prepare|digest|tar|rust ...');
}

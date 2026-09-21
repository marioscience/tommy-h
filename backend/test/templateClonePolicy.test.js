import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplateFingerprintCommand, selectTemplateCloneStrategy, templateCacheMatches } from '../src/services/dockerUtils.js';

const GIB = 1024 ** 3;

test('template clone selects reflink only when source and destination share a device', () => {
  assert.equal(selectTemplateCloneStrategy({ sourceDevice: '42', targetDevice: '42', templateBytes: 70 * GIB, availableBytes: 1 * GIB }), 'reflink');
});

test('cross-device template clone selects an independent copy when space plus reserve is available', () => {
  assert.equal(selectTemplateCloneStrategy({ sourceDevice: '48', targetDevice: '42', templateBytes: 20 * GIB, availableBytes: 40 * GIB, reserveBytes: 15 * GIB }), 'copy');
});

test('cross-device template clone fails before copying when it would consume the host reserve', () => {
  assert.throws(() => selectTemplateCloneStrategy({ sourceDevice: '48', targetDevice: '42', templateBytes: 70 * GIB, availableBytes: 75 * GIB, reserveBytes: 15 * GIB }), /Espacio insuficiente.*85\.0 GB.*75\.0 GB/);
});

test('template clone refuses unknown device information', () => {
  assert.throws(() => selectTemplateCloneStrategy({ sourceDevice: '', targetDevice: '42', templateBytes: 1, availableBytes: 100 }), /determinar el dispositivo/);
});

test('local template cache is reused only when its content fingerprint matches', () => {
  const fingerprint = 'a'.repeat(64);
  assert.equal(templateCacheMatches(`${fingerprint}\n`, fingerprint), true);
  assert.equal(templateCacheMatches('b'.repeat(64), fingerprint), false);
  assert.equal(templateCacheMatches('', fingerprint), false);
});

test('template fingerprint command is portable to BusyBox find', () => {
  const command = buildTemplateFingerprintCommand('/srv/ragenodes data/templates/sdtd-master');
  assert.match(command, /find \. -type f/);
  assert.match(command, /-exec stat -c/);
  assert.doesNotMatch(command, /-printf/);
  assert.match(command, /'\/srv\/ragenodes data\/templates\/sdtd-master'/);
});

test('runtime template policy does not depend on GNU find printf', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) =>
    readFile(new URL('../src/services/dockerUtils.js', import.meta.url), 'utf8')
  );
  assert.doesNotMatch(source, /find[^\n]*-printf/);
});

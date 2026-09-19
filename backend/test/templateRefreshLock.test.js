import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplateReadLockedCommand } from '../src/services/dockerUtils.js';

test('template clones take a shared per-game lock', () => {
  const command = buildTemplateReadLockedCommand('sdtd', "cp -a '/source/.' '/target/'");
  assert.match(command, /flock -s/);
  assert.match(command, /sdtd\.lock/);
  assert.match(command, /bash -c/);
  assert.match(command, /cp -a/);
});

test('template lock rejects shell metacharacters in game names', () => {
  assert.throws(() => buildTemplateReadLockedCommand('sdtd; reboot', 'true'), /inválido/);
});

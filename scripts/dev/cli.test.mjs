import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function cli(...args) {
  return spawnSync(process.execPath, ['scripts/dev/cli.mjs', ...args], { encoding: 'utf8' });
}

test('help documents the complete portable workflow', () => {
  const result = cli('help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /test \[all\|frontend\|backend\|proxy\]/);
  assert.match(result.stdout, /verify \[frontend\|core\]/);
  assert.match(result.stdout, /game-smoke/);
});

test('destructive local cleanup requires an explicit literal confirmation', () => {
  const result = cli('clean');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /clean --confirm/);
});

test('game smoke refuses implicit infrastructure assumptions', () => {
  const result = cli('game-smoke', 'minecraft');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GAME_SMOKE_HOST/);
});

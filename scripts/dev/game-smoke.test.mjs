import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_PROFILES, queryGame, smokeOptions } from './game-smoke.mjs';

test('all supported game profiles have valid immutable defaults', () => {
  assert.ok(Object.isFrozen(GAME_PROFILES));
  assert.deepEqual(Object.keys(GAME_PROFILES).sort(), ['7dtd', 'ark', 'cs2', 'fivem', 'minecraft', 'palworld', 'rust', 'valheim', 'zomboid']);
  for (const profile of Object.values(GAME_PROFILES)) {
    assert.match(profile.type, /^[a-z0-9]+$/);
    assert.ok(profile.port > 0 && profile.port < 65536);
  }
});

test('smoke configuration is portable and validates operator input', () => {
  assert.throws(() => smokeOptions('minecraft', {}), /GAME_SMOKE_HOST/);
  assert.throws(() => smokeOptions('unknown', { GAME_SMOKE_HOST: 'localhost' }), /Juego desconocido/);
  assert.equal(smokeOptions('minecraft', { GAME_SMOKE_HOST: 'example.test' }).port, 25565);
  assert.equal(smokeOptions('rust', { GAME_SMOKE_HOST: '127.0.0.1', GAME_SMOKE_PORT: '28099' }).port, 28099);
});

test('query adapter returns a stable report without exposing GameDig internals', async () => {
  const result = await queryGame('minecraft', { GAME_SMOKE_HOST: 'example.test' }, async options => ({
    name: 'fixture', map: 'world', players: [{ name: 'one' }], maxplayers: 20, connect: `${options.host}:${options.port}`
  }));
  assert.equal(result.name, 'fixture');
  assert.equal(result.players, 1);
  assert.equal(result.connect, 'example.test:25565');
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { reconcileAutomaticRoutes } = require('./routeReconciliation');

const route = (name, gameId) => ({ name, game_id: gameId, protocol: 'TCP' });

test('preserva una ruta durante dos inventarios parciales y la restaura sin reinicio', () => {
    const misses = new Map();
    const current = [route('auto:minecraft:25565', 25565)];
    const first = reconcileAutomaticRoutes(current, [], misses, 3);
    const second = reconcileAutomaticRoutes(first, [], misses, 3);
    const recovered = reconcileAutomaticRoutes(second, current, misses, 3);

    assert.deepEqual(first, current);
    assert.deepEqual(second, current);
    assert.deepEqual(recovered, current);
    assert.equal(misses.size, 0);
});

test('retira una ruta solo tras ausencias consecutivas confirmadas', () => {
    const misses = new Map();
    const current = [route('auto:minecraft:25565', 25565)];
    const first = reconcileAutomaticRoutes(current, [], misses, 3);
    const second = reconcileAutomaticRoutes(first, [], misses, 3);
    const third = reconcileAutomaticRoutes(second, [], misses, 3);

    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(third.length, 0);
});

test('produce un orden estable aunque el backend cambie el orden', () => {
    const misses = new Map();
    const routes = [route('auto:zomboid:16261', 16261), route('auto:minecraft:25565', 25565)];
    const reconciled = reconcileAutomaticRoutes([], routes, misses, 3);

    assert.deepEqual(reconciled.map(item => item.name), [
        'auto:minecraft:25565',
        'auto:zomboid:16261'
    ]);
});

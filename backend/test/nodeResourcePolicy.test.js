import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertStartMemoryAvailable,
  calculateReservableRamGb,
  getNodeRamPolicy
} from '../src/services/nodeResourcePolicy.js';

test('limita la sobreasignacion y protege memoria para el host', () => {
  const policy = getNodeRamPolicy({
    NODE_RAM_OVERCOMMIT_RATIO: '1.5',
    NODE_HOST_RAM_RESERVE_GB: '8'
  });
  assert.equal(calculateReservableRamGb(102, policy), 141);
});

test('rechaza un arranque que invadiria la reserva fisica', () => {
  const policy = { overcommitRatio: 1.5, hostReserveGb: 8 };
  assert.throws(
    () => assertStartMemoryAvailable(9, 2, policy),
    /Memoria fisica insuficiente/
  );
});

test('permite un arranque con margen fisico suficiente', () => {
  const policy = { overcommitRatio: 1.5, hostReserveGb: 8 };
  assert.doesNotThrow(() => assertStartMemoryAvailable(20, 4, policy));
});

test('acota configuraciones de sobreasignacion peligrosas', () => {
  assert.deepEqual(
    getNodeRamPolicy({ NODE_ENV: 'production', NODE_RAM_OVERCOMMIT_RATIO: '9', NODE_HOST_RAM_RESERVE_GB: '1' }),
    { overcommitRatio: 2, hostReserveGb: 4 }
  );
});

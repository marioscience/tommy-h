import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';

describe('PostgreSQL pool lifecycle', () => {
  it('handles an unexpected idle-client error without crashing the process', () => {
    assert.ok(pool.listenerCount('error') > 0, 'the pool must register an error listener');
    assert.doesNotThrow(() => {
      pool.emit('error', Object.assign(new Error('simulated administrator restart'), {
        code: '57P01'
      }));
    });
  });
});

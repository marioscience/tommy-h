import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

  it('keeps Discord routes on the shared resilient pool', () => {
    const source = fs.readFileSync(new URL('../src/routes/discord.js', import.meta.url), 'utf8');
    assert.ok(source.includes("import { query } from '../db.js'"));
    assert.ok(!source.includes('new Pool('), 'Discord must not create an unmanaged PostgreSQL pool');
    assert.ok(!source.includes('pool.query('), 'Discord must use the shared query function');
  });
});

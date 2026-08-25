import test from 'node:test';
import assert from 'node:assert/strict';
import { hasManagedDatabase } from '../src/services/backupPolicy.js';

test('backups do not require MariaDB for game templates without a managed database', () => {
  for (const template of ['minecraft', 'rust', 'palworld', 'cs2', 'valheim', 'zomboid', 'sdtd', 'discordbot', 'blender']) {
    assert.equal(hasManagedDatabase({ template, db_name: null }), false, template);
  }
});

test('backups include MariaDB only when the server owns a valid database name', () => {
  assert.equal(hasManagedDatabase({ template: 'fivem', db_name: 'fivem_a1b2c3d4' }), true);
  assert.equal(hasManagedDatabase({ template: 'ark', db_name: 'ark_a1b2c3d4' }), true);
  assert.equal(hasManagedDatabase({ template: 'fivem', db_name: '' }), false);
});

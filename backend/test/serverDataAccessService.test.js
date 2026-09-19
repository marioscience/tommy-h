import test from 'node:test';
import assert from 'node:assert/strict';
import { isDataPermissionError } from '../src/services/serverDataAccessService.js';

test('reconoce errores de permisos que admiten normalizacion y reintento', () => {
  assert.equal(isDataPermissionError({ code: 'EACCES' }), true);
  assert.equal(isDataPermissionError({ code: 'EPERM' }), true);
  assert.equal(isDataPermissionError(new Error('tar: Permission denied')), true);
  assert.equal(isDataPermissionError({ code: 'ENOENT' }), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { isPortBindingConflict } from '../src/services/portBindingConflict.js';

test('detecta colisiones de puertos reportadas por RootlessKit', () => {
  const error = new Error(
    'RootlessKit PortManager.AddPort(): listen tcp4 0.0.0.0:40120: bind: address already in use'
  );
  assert.equal(isPortBindingConflict(error), true);
});

test('detecta colisiones de puertos anidadas en cause', () => {
  const error = new Error('Docker no pudo iniciar el contenedor', {
    cause: new Error('failed to bind host port: port is already allocated')
  });
  assert.equal(isPortBindingConflict(error), true);
});

test('no reintenta errores de imagen o configuración', () => {
  assert.equal(isPortBindingConflict(new Error('pull access denied for image')), false);
  assert.equal(isPortBindingConflict(new Error('invalid mount config')), false);
});

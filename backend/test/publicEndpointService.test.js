import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPublicEndpointUrl } from '../src/services/publicEndpointService.js';

describe('publicEndpointService', () => {
  it('genera una URL HTTP directa para desarrollo local', () => {
    assert.equal(
      getPublicEndpointUrl(40120, { host: 'localhost', scheme: 'http' }),
      'http://localhost:40120/'
    );
  });

  it('acepta un host configurado como URL sin duplicar el protocolo', () => {
    assert.equal(
      getPublicEndpointUrl(40120, { host: 'https://node1.ragenodes.com/path', scheme: 'https', path: '' }),
      'https://node1.ragenodes.com:40120'
    );
  });

  it('rechaza puertos fuera del rango TCP', () => {
    assert.throws(() => getPublicEndpointUrl(70000), /Puerto publico invalido/);
  });
});

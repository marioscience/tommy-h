import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDataSubdirectory } from '../src/services/games/BaseGameService.js';
import { sh } from '../src/services/dockerUtils.js';

describe('Preparación segura de directorios de juego', () => {
  it('construye txData dentro de la ruta asignada sin comillas anidadas', () => {
    const target = resolveDataSubdirectory('/srv/ragenodes-staging-data/server-id', 'txData');
    assert.equal(target, '/srv/ragenodes-staging-data/server-id/txData');
    assert.equal(sh`mkdir -p ${target}`, "mkdir -p '/srv/ragenodes-staging-data/server-id/txData'");
  });

  it('escapa rutas con espacios y comillas sin permitir inyección de shell', () => {
    const target = resolveDataSubdirectory("/srv/ragenodes-data/server O'Reilly", 'txData');
    assert.equal(
      sh`mkdir -p ${target}`,
      "mkdir -p '/srv/ragenodes-data/server O'\\''Reilly/txData'"
    );
  });

  it('rechaza rutas relativas, absolutas anidadas y traversal', () => {
    assert.throws(() => resolveDataSubdirectory('srv/data', 'txData'));
    assert.throws(() => resolveDataSubdirectory('/srv/data', '/etc'));
    assert.throws(() => resolveDataSubdirectory('/srv/data/server', '../../etc'));
  });
});

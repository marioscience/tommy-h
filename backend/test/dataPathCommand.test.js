import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDataSubdirectory } from '../src/services/games/BaseGameService.js';
import { buildTemplateStreamCommand, commandStdout, sh } from '../src/services/dockerUtils.js';
import { buildSDTDInstallationCheck } from '../src/services/games/sdtd.js';
import { buildARKHostConfig } from '../src/services/games/ark.js';
import { config } from '../src/config.js';

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

  it('construye rutas de plantilla sin comillas duplicadas', () => {
    const master = '/srv/ragenodes-data/templates/ark-master/.';
    const target = '/srv/ragenodes-data/server-id/';
    assert.equal(
      sh`cp --reflink=always -a ${master} ${target}`,
      "cp --reflink=always -a '/srv/ragenodes-data/templates/ark-master/.' '/srv/ragenodes-data/server-id/'"
    );
  });

  it('copia plantillas por flujo entre sistemas de archivos distintos', () => {
    assert.equal(
      buildTemplateStreamCommand("/srv/data/templates/rust master", "/srv/data/server O'Reilly"),
      "(cd '/srv/data/templates/rust master' && tar -cf - .) | (cd '/srv/data/server O'\\''Reilly' && tar -xf -)"
    );
  });

  it('normaliza stdout local para comprobaciones de ARK y 7DTD', () => {
    assert.equal(commandStdout({ stdout: 'yes', stderr: '' }), 'yes');
    assert.equal(commandStdout('yes'), 'yes');
    assert.equal(commandStdout(true), '');
  });

  it('solo considera completa una instalacion 7DTD con binario, Unity y datos', () => {
    const command = buildSDTDInstallationCheck('/srv/ragenodes-data/server-id');
    assert.match(command, /7DaysToDieServer\.x86_64/);
    assert.match(command, /UnityPlayer\.so/);
    assert.match(command, /globalgamemanagers/);
  });

  it('permite a Proton preparar el prefix solo en el contenedor ARK', () => {
    const bindings = { '7777/udp': [{ HostIp: '127.0.0.1', HostPort: '17777' }] };
    const hostConfig = buildARKHostConfig({
      dataPath: '/srv/ragenodes-data/server-id',
      plan: { memoryBytes: 8 * 1024 ** 3, nanoCpus: 4 * 10 ** 9 }
    }, [], bindings);
    assert.deepEqual(hostConfig.SecurityOpt, []);
    assert.ok(hostConfig.CapAdd.includes('SETUID'));
    assert.ok(hostConfig.CapAdd.includes('SETGID'));
    assert.equal(hostConfig.NetworkMode, undefined);
    assert.deepEqual(hostConfig.PortBindings, bindings);
    if (!config.dockerBlkioWeight) assert.equal(hostConfig.BlkioWeight, undefined);
  });

  it('rechaza rutas relativas, absolutas anidadas y traversal', () => {
    assert.throws(() => resolveDataSubdirectory('srv/data', 'txData'));
    assert.throws(() => resolveDataSubdirectory('/srv/data', '/etc'));
    assert.throws(() => resolveDataSubdirectory('/srv/data/server', '../../etc'));
  });
});

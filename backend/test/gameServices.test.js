import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { GameFactory } from '../src/services/games/GameFactory.js';
import { BaseGameService, normalizeSharedDataPermissions } from '../src/services/games/BaseGameService.js';
import { FiveMService, fivemService } from '../src/services/games/fivem.js';
import { RustGameService, rustGameService } from '../src/services/games/rust.js';
import { MinecraftService, minecraftService, normalizeMinecraftIdentity, resolveMinecraftIdentity } from '../src/services/games/minecraft.js';
import { config } from '../src/config.js';

describe('🏭 GameFactory & OOP Architecture Tests (Módulo 3 & 4)', () => {
    it('debería registrar y recuperar instancias de juegos correctamente', () => {
        assert.ok(GameFactory.has('fivem'), 'FiveM debe estar registrado');
        assert.ok(GameFactory.has('rust'), 'Rust debe estar registrado');
        assert.ok(GameFactory.has('minecraft'), 'Minecraft debe estar registrado');

        const fivem = GameFactory.get('fivem');
        assert.ok(fivem instanceof BaseGameService);
        assert.ok(fivem instanceof FiveMService);

        const rust = GameFactory.get('rust');
        assert.ok(rust instanceof BaseGameService);
        assert.ok(rust instanceof RustGameService);

        const mc = GameFactory.get('minecraft');
        assert.ok(mc instanceof BaseGameService);
        assert.ok(mc instanceof MinecraftService);
    });

    it('debería no permitir instanciar BaseGameService directamente (Clase Abstracta)', () => {
        assert.throws(() => {
            new BaseGameService('abstract', 'image:latest');
        }, TypeError);
    });

    it('debería construir variables de entorno y mapeos de puertos polimórficamente', () => {
        const fivem = GameFactory.get('fivem');
        const fivemPorts = fivem.buildPortBindings({ fivemPort: 30120, txadminPort: 40120 });
        assert.ok(fivemPorts.bindings['30120/tcp']);
        assert.ok(fivemPorts.bindings['40120/tcp']);

        const rust = GameFactory.get('rust');
        const rustPorts = rust.buildPortBindings({ gamePort: 28015 });
        assert.ok(rustPorts.bindings['28015/udp']);
        assert.ok(rustPorts.bindings['28016/tcp']); // RCON
        assert.ok(rustPorts.bindings['28017/udp']); // Query

        const minecraft = GameFactory.get('minecraft');
        const minecraftEnv = minecraft.buildEnvironment({
            serverName: 'test',
            plan: { memoryBytes: 4 * 1024 * 1024 * 1024 }
        });
        assert.ok(minecraftEnv.includes(`GID=${config.gameContainerSharedGid}`));
        assert.ok(minecraftEnv.includes('UMASK=0002'));
        assert.ok(minecraftEnv.includes('PAUSE_WHEN_EMPTY_SECONDS=-1'));

        const minecraftHost = minecraft.buildHostConfig(
            { plan: { memoryBytes: 4 * 1024 * 1024 * 1024, nanoCpus: 2 * 10**9 } },
            { bindings: {} },
            ['/tmp/test:/data']
        );
        assert.deepEqual(minecraftHost.GroupAdd, [String(config.gameContainerSharedGid)]);
    });

    it('fija una identidad explícita para Minecraft y rechaza LATEST', () => {
        assert.deepEqual(normalizeMinecraftIdentity('1.21.4', 'forge'), {
            version: '1.21.4',
            type: 'FORGE'
        });
        assert.throws(
            () => normalizeMinecraftIdentity('LATEST', 'PAPER'),
            /versión de Minecraft debe ser explícita/
        );
    });

    it('conserva la identidad al reiniciar y sustituye una identidad de un servidor eliminado', () => {
        const locked = { version: '1.21.4', type: 'PAPER', serverId: 'old-id' };
        assert.deepEqual(
            resolveMinecraftIdentity({ version: '1.21.4', type: 'FORGE' }, locked, 'old-id'),
            { version: '1.21.4', type: 'PAPER' }
        );
        assert.deepEqual(
            resolveMinecraftIdentity({ version: '1.21.4', type: 'FORGE' }, locked, 'new-id'),
            { version: '1.21.4', type: 'FORGE' }
        );
    });

    it('debería lanzar error controlado al solicitar un juego no soportado', () => {
        assert.throws(() => {
            GameFactory.get('unsupported_game_xyz');
        }, /no soportado/);
    });

    it('normaliza el volumen compartido sin abrir permisos a otros usuarios', async () => {
        let execOptions;
        const container = {
            async exec(options) {
                execOptions = options;
                return {
                    async start() {
                        const stream = new PassThrough();
                        queueMicrotask(() => stream.end());
                        return stream;
                    },
                    async inspect() { return { ExitCode: 0 }; }
                };
            }
        };

        await normalizeSharedDataPermissions(container, 0);
        assert.equal(execOptions.User, '0');
        assert.match(execOptions.Cmd[2], /chgrp -R 0 \/data/);
        assert.match(execOptions.Cmd[2], /chmod -R g\+rwX,o= \/data/);
        assert.doesNotMatch(execOptions.Cmd[2], /777/);
    });
});

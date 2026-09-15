import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectZomboidRuntime, parseProjectZomboidMods } from '../src/services/games/zomboid.js';
import { SOURCE_RCON_GAMES, parseZomboidPlayers } from '../src/services/rconService.js';

describe('Project Zomboid RCON contract', () => {
    it('activates Source RCON with the same password used by the panel', () => {
        const runtime = buildProjectZomboidRuntime({
            serverName: 'test',
            serverId: 'server-1',
            containerName: 'ragenodes-server-1',
            gamePort: 26200
        });

        const adminPassword = runtime.environment.find((item) => item.startsWith('ADMIN_PASSWORD=')).slice('ADMIN_PASSWORD='.length);
        assert.ok(runtime.environment.includes('RCON_PORT=27015'));
        assert.ok(runtime.environment.includes(`RCON_PASSWORD=${adminPassword}`));
        assert.deepEqual(runtime.publicBindings['27015/tcp'], [{ HostIp: '0.0.0.0', HostPort: '26201' }]);
        assert.ok(runtime.exposedPorts['27015/tcp']);
        assert.ok(SOURCE_RCON_GAMES.includes('zomboid'));
    });

    it('preserves validated Workshop configuration when recreating the container', () => {
        const parsed = parseProjectZomboidMods([
            'Mods=eris_minimap;safe_mod;bad value',
            'WorkshopItems=1619603097;123456;not-a-number'
        ].join('\n'));
        const runtime = buildProjectZomboidRuntime({
            serverName: 'test', serverId: 'server-1', gamePort: 26200, ...parsed
        });

        assert.ok(runtime.environment.includes('MOD_NAMES=eris_minimap;safe_mod'));
        assert.ok(runtime.environment.includes('MOD_WORKSHOP_IDS=1619603097;123456'));
    });

    it('parses the Build 42 players response without inventing console entries', () => {
        assert.deepEqual(parseZomboidPlayers('Players connected (0):'), []);
        assert.deepEqual(parseZomboidPlayers('Players connected (2):\n-Mario\n-Niko'), [
            { name: 'Mario', steamId: 'Mario' },
            { name: 'Niko', steamId: 'Niko' }
        ]);
    });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectZomboidRuntime } from '../src/services/games/zomboid.js';
import { SOURCE_RCON_GAMES } from '../src/services/rconService.js';

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
});

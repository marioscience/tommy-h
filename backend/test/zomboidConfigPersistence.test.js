import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getZomboidConfig, saveZomboidConfig } from '../src/services/zomboidService.js';

const temporaryPaths = [];

async function makeInstance() {
    const instancePath = await fs.mkdtemp(path.join(os.tmpdir(), 'ragenodes-zomboid-'));
    temporaryPaths.push(instancePath);
    return instancePath;
}

afterEach(async () => {
    await Promise.all(temporaryPaths.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
});

describe('Project Zomboid configuration persistence', () => {
    it('keeps a saved password after a restart-style reload', async () => {
        const instancePath = await makeInstance();
        await saveZomboidConfig(instancePath, { Password: 'persistent-secret' }, 'my-server');

        const reloaded = await getZomboidConfig(instancePath, 'my-server');
        assert.equal(reloaded.Password, 'persistent-secret');
        assert.equal(reloaded.PublicName, 'RageNodes | Project Zomboid');
        await fs.access(path.join(instancePath, 'Zomboid', 'Server', 'my-server.ini'));
    });

    it('updates the active named INI without touching stale configurations', async () => {
        const instancePath = await makeInstance();
        const cfgDir = path.join(instancePath, 'Zomboid', 'Server');
        await fs.mkdir(cfgDir, { recursive: true });
        await fs.writeFile(path.join(cfgDir, 'old.ini'), 'Password=old-password\n');
        await fs.writeFile(path.join(cfgDir, 'active.ini'), 'Password=before\nMaxPlayers=24\n');

        await saveZomboidConfig(instancePath, { Password: 'after' }, 'active');

        assert.match(await fs.readFile(path.join(cfgDir, 'active.ini'), 'utf8'), /^Password=after$/m);
        assert.match(await fs.readFile(path.join(cfgDir, 'active.ini'), 'utf8'), /^MaxPlayers=24$/m);
        assert.equal(await fs.readFile(path.join(cfgDir, 'old.ini'), 'utf8'), 'Password=old-password\n');
    });

    it('rejects newline injection and ambiguous legacy INI files', async () => {
        const instancePath = await makeInstance();
        await assert.rejects(
            saveZomboidConfig(instancePath, { Password: 'ok\nRCONPassword=stolen' }, 'active'),
            /Valor inválido/
        );

        const cfgDir = path.join(instancePath, 'Zomboid', 'Server');
        await fs.writeFile(path.join(cfgDir, 'one.ini'), 'Password=one\n');
        await fs.writeFile(path.join(cfgDir, 'two.ini'), 'Password=two\n');
        await assert.rejects(getZomboidConfig(instancePath, 'missing'), /ambigua/);
    });
});

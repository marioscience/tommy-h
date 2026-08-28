import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getSDTDConfig, saveSDTDConfig } from '../src/services/sdtdService.js';

describe('Configuracion segura de 7DTD', () => {
  it('genera las claves de mundo y guardado requeridas por 7DTD 2.x', async () => {
    const instancePath = await fs.mkdtemp(path.join(os.tmpdir(), 'ragenodes-sdtd-'));
    try {
      await saveSDTDConfig(instancePath, { ServerPort: '26904' });
      const content = await fs.readFile(path.join(instancePath, 'config', 'serverconfig.xml'), 'utf8');

      for (const key of ['UserDataFolder', 'GameWorld', 'WorldGenSeed', 'WorldGenSize', 'GameName']) {
        assert.match(content, new RegExp(`name="${key}"`));
      }
      assert.match(content, /name="ServerPort" value="26904"/);
    } finally {
      await fs.rm(instancePath, { recursive: true, force: true });
    }
  });

  it('escapa valores antes de escribir atributos XML', async () => {
    const instancePath = await fs.mkdtemp(path.join(os.tmpdir(), 'ragenodes-sdtd-'));
    try {
      await saveSDTDConfig(instancePath, { ServerName: 'A & B "test" <safe>' });
      const content = await fs.readFile(path.join(instancePath, 'config', 'serverconfig.xml'), 'utf8');
      assert.match(content, /value="A &amp; B &quot;test&quot; &lt;safe&gt;"/);
      assert.equal((await getSDTDConfig(instancePath)).ServerName, 'A & B "test" <safe>');
    } finally {
      await fs.rm(instancePath, { recursive: true, force: true });
    }
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareArkData, ARK_PREPARE_SCRIPT } from '../src/services/games/arkData.js';

const options = { image: 'ark:test', dataRoot: '/instances', dataPath: '/instances/11111111-1111-4111-8111-111111111111' };
test('ARK prepares data in a restricted namespace helper and does not reuse templates', async () => {
    let spec; let removed = false;
    const docker = { createContainer: async s => { spec = s; return {
        start: async () => {}, wait: async () => ({ StatusCode: 0 }), remove: async () => { removed = true; }
    }; } };
    await prepareArkData({ ...options, docker });
    assert.equal(spec.User, '0:0');
    assert.equal(spec.HostConfig.NetworkMode, 'none');
    assert.equal(spec.HostConfig.ReadonlyRootfs, true);
    assert.deepEqual(spec.HostConfig.Binds, [options.dataRoot + ':/data:rw']);
    assert.deepEqual(spec.Env, ['ARK_SERVER_ID=11111111-1111-4111-8111-111111111111']);
    assert.deepEqual(spec.HostConfig.CapDrop, ['ALL']);
    assert.equal(removed, true);
    assert.match(ARK_PREPARE_SCRIPT, /tar -cf - \./);
    assert.match(ARK_PREPARE_SCRIPT, /tar -xf -/);
    assert.doesNotMatch(ARK_PREPARE_SCRIPT, /\bcp\b/);
    assert.ok(ARK_PREPARE_SCRIPT.indexOf('mkdir -p "$target"') < ARK_PREPARE_SCRIPT.indexOf('find "$target"'));
    assert.match(ARK_PREPARE_SCRIPT, /copy failed after 3 resumable attempts/);
    assert.match(ARK_PREPARE_SCRIPT, /resuming attempt \$copy_attempt\/3/);
    assert.match(ARK_PREPARE_SCRIPT, /templates\/ark-master/);
    assert.doesNotMatch(ARK_PREPARE_SCRIPT, /rm -rf/);
    assert.match(ARK_PREPARE_SCRIPT, /find "\$target" -mindepth 1 -exec chown -h 1000:1000/);
});
test('ARK helper failure propagates and helper is removed', async () => {
    let removed = false;
    const docker = { createContainer: async () => ({
        start: async () => {}, wait: async () => ({ StatusCode: 1 }),
        logs: async () => Buffer.from('ARK prepare: normalizing ownership\nchown: denied\n'),
        remove: async () => { removed = true; }
    }) };
    await assert.rejects(prepareArkData({ ...options, docker }), /normalizing ownership.*chown: denied/s);
    assert.equal(removed, true);
});
test('ARK rejects broad or traversing mount paths before Docker access', async () => {
    for (const dataPath of ['/', '/instances', '/etc', '/instances/../etc', '/instances/not-a-uuid']) {
        await assert.rejects(prepareArkData({ ...options, dataPath, docker: {} }), /UUID/);
    }
});

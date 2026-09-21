import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  removeServerDataWithDocker,
  resolveSafeServerDataPath
} from '../src/services/serverDataCleanup.js';
import { config } from '../src/config.js';

const SERVER_ID = '8b0a92b2-7663-436d-9eac-7ee670a935d4';

function createDockerMock(statusCode = 0) {
  const calls = { createOptions: null, started: false, removed: false };
  const helper = {
    async start() { calls.started = true; },
    async wait() { return { StatusCode: statusCode }; },
    async remove() { calls.removed = true; }
  };
  return {
    calls,
    docker: {
      getImage() { return { async inspect() {} }; },
      async createContainer(options) {
        calls.createOptions = options;
        return helper;
      }
    }
  };
}

describe('server data cleanup', () => {
  it('accepts only the direct UUID directory assigned to the server', () => {
    assert.deepEqual(
      resolveSafeServerDataPath('/srv/ragenodes-data', SERVER_ID, `/srv/ragenodes-data/${SERVER_ID}`),
      {
        dataRoot: '/srv/ragenodes-data',
        dataPath: `/srv/ragenodes-data/${SERVER_ID}`
      }
    );

    assert.throws(
      () => resolveSafeServerDataPath('/srv/ragenodes-data', SERVER_ID, '/srv/ragenodes-data'),
      /outside the instance root/
    );
    assert.throws(
      () => resolveSafeServerDataPath('/srv/ragenodes-data', SERVER_ID, `/srv/ragenodes-data/${SERVER_ID}/nested`),
      /outside the instance root/
    );
    assert.throws(
      () => resolveSafeServerDataPath('/srv/ragenodes-data', 'not-a-uuid', '/srv/ragenodes-data/not-a-uuid'),
      /invalid server id/
    );
  });

  it('runs a minimally privileged, network-isolated helper against the instance root', async () => {
    const { docker, calls } = createDockerMock();
    await removeServerDataWithDocker({
      docker,
      dataRoot: '/srv/ragenodes-data',
      serverId: SERVER_ID,
      dataPath: `/srv/ragenodes-data/${SERVER_ID}`,
      image: 'test-cleanup-image'
    });

    assert.equal(calls.started, true);
    assert.equal(calls.removed, true);
    assert.deepEqual(calls.createOptions.Entrypoint, ['/bin/rm']);
    assert.deepEqual(calls.createOptions.Cmd, ['-rf', '--', `/instances/${SERVER_ID}`]);
    assert.deepEqual(calls.createOptions.HostConfig.Binds, ['/srv/ragenodes-data:/instances:rw']);
    assert.equal(calls.createOptions.HostConfig.NetworkMode, 'none');
    assert.equal(calls.createOptions.HostConfig.ReadonlyRootfs, true);
    if (config.nodeEnv === 'production') {
      assert.deepEqual(calls.createOptions.HostConfig.CapDrop, ['ALL']);
      assert.deepEqual(calls.createOptions.HostConfig.CapAdd, ['DAC_OVERRIDE', 'FOWNER']);
    } else {
      assert.equal(calls.createOptions.HostConfig.CapDrop, undefined);
    }
  });

  it('fails the operation but still removes the helper when cleanup fails', async () => {
    const { docker, calls } = createDockerMock(9);
    await assert.rejects(
      removeServerDataWithDocker({
        docker,
        dataRoot: '/srv/ragenodes-data',
        serverId: SERVER_ID,
        dataPath: `/srv/ragenodes-data/${SERVER_ID}`,
        image: 'test-cleanup-image'
      }),
      /exited with code 9/
    );
    assert.equal(calls.removed, true);
  });
});

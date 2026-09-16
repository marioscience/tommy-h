import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimServerRecreation,
  findServerNodeIdByContainer,
  findSubuserPermissions,
  listMaintainableServers
} from '../src/repositories/serverRepository.js';
import { listActiveNodeIds, updateNode } from '../src/repositories/nodeRepository.js';
import { activateEdgeProxy, updateEdgeProxy } from '../src/repositories/edgeProxyRepository.js';
import { updateAdminUser } from '../src/repositories/userRepository.js';
import { createNotification, listClientNotifications } from '../src/repositories/notificationRepository.js';
import { recordBackup } from '../src/repositories/backupRepository.js';
import {
  claimDeployment,
  enqueueDeployment,
  failDeployment,
  recoverStaleDeployments
} from '../src/repositories/deploymentJobRepository.js';

describe('SQL repositories', () => {
  it('enqueues deployments idempotently and claims them with SKIP LOCKED', async () => {
    const statements = [];
    const db = async (sql, parameters) => {
      statements.push({ sql, parameters });
      return { rows: [{ id: 'job-1' }] };
    };
    const job = await enqueueDeployment(9, 'request-1', { template: 'ark' }, db);
    assert.equal(job.id, 'job-1');
    assert.match(statements[0].sql, /ON CONFLICT \(owner_id, idempotency_key\)/);
    assert.deepEqual(statements[0].parameters, [9, 'request-1', '{"template":"ark"}', null, null, null, null, 'standard']);

    const claimed = await claimDeployment('worker-a', async (callback) => callback(db));
    assert.equal(claimed.id, 'job-1');
    assert.match(statements[1].sql, /FOR UPDATE SKIP LOCKED/);
    assert.match(statements[1].sql, /attempts = attempts \+ 1/);
    assert.match(statements[1].sql, /deployment_worker_leases/);
    assert.deepEqual(statements[1].parameters, ['worker-a', null, 1, 4, 8, 4, 32]);
  });

  it('backs failed deployments off and recovers abandoned leases', async () => {
    const statements = [];
    const db = async (sql, parameters) => {
      statements.push({ sql, parameters });
      return { rows: [{ id: 'job-1', status: 'queued' }] };
    };
    await failDeployment('job-1', 'temporary', db);
    await recoverStaleDeployments(45, db);
    assert.match(statements[0].sql, /POWER\(2, GREATEST\(attempts - 1, 0\)\)/);
    assert.equal(statements[0].parameters[2], 'temporary');
    assert.match(statements[1].sql, /claimed_at < NOW\(\) -/);
    assert.deepEqual(statements[1].parameters, [45]);
  });

  it('does not auto-heal servers while creation or recreation owns their runtime', async () => {
    const calls = [];
    const db = async (sql, parameters) => {
      calls.push({ sql, parameters });
      return { rows: [] };
    };

    await listMaintainableServers(db);
    assert.match(calls[0].sql, /'creating', 'recreating'/);
  });

  it('claims server recreation atomically', async () => {
    const calls = [];
    const db = async (sql, parameters) => {
      calls.push({ sql, parameters });
      return { rowCount: 1 };
    };

    assert.equal(await claimServerRecreation('server-1', db), true);
    assert.match(calls[0].sql, /status != 'recreating'/);
    assert.deepEqual(calls[0].parameters, ['server-1']);
  });

  it('returns stable fallbacks for absent server relations', async () => {
    const emptyDb = async () => ({ rows: [] });
    assert.equal(await findSubuserPermissions('server-1', 'user-1', emptyDb), null);
    assert.equal(await findServerNodeIdByContainer('missing', emptyDb), 0);
  });

  it('updates only whitelisted node fields in one parameterized statement', async () => {
    const calls = [];
    const db = async (sql, parameters) => {
      calls.push({ sql, parameters });
      return { rowCount: 1 };
    };

    await updateNode(7, {
      name: 'Cerbero',
      status: 'active',
      'status = \'offline\' --': 'malicious'
    }, db);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].sql, 'UPDATE nodes SET name = $1, status = $2 WHERE id = $3');
    assert.deepEqual(calls[0].parameters, ['Cerbero', 'active', 7]);
  });

  it('does not execute an empty node update', async () => {
    let called = false;
    const result = await updateNode(7, { unknown: 'value', name: '' }, async () => {
      called = true;
    });
    assert.equal(called, false);
    assert.deepEqual(result, { rowCount: 0 });
  });

  it('maps active node rows to identifiers', async () => {
    const ids = await listActiveNodeIds(async () => ({ rows: [{ id: 2 }, { id: 5 }] }));
    assert.deepEqual(ids, [2, 5]);
  });

  it('avoids WAL writes when node capacity did not change', async () => {
    const calls = [];
    const { updateNodeCapacity } = await import('../src/repositories/nodeRepository.js');
    await updateNodeCapacity(3, 64, 16, async (sql, parameters) => {
      calls.push({ sql, parameters });
      return { rowCount: 0 };
    });
    assert.match(calls[0].sql, /IS DISTINCT FROM/);
    assert.deepEqual(calls[0].parameters, [64, 16, 3]);
  });

  it('activates an edge proxy inside one transaction and rejects a missing target', async () => {
    const statements = [];
    const transaction = async (callback) => callback(async (sql, parameters = []) => {
      statements.push({ sql, parameters });
      return { rowCount: sql.includes('WHERE id') ? 1 : 2 };
    });
    assert.equal(await activateEdgeProxy(4, transaction), true);
    assert.equal(statements.length, 2);
    assert.match(statements[0].sql, /is_active = false/);
    assert.deepEqual(statements[1].parameters, [4]);

    await assert.rejects(
      activateEdgeProxy(99, async (callback) => callback(async () => ({ rowCount: 0 }))),
      /EDGE_PROXY_NOT_FOUND/
    );
  });

  it('whitelists dynamic user and edge-proxy updates', async () => {
    const calls = [];
    const db = async (sql, parameters) => { calls.push({ sql, parameters }); return { rowCount: 1 }; };
    await updateAdminUser(3, { username: 'safe', injected: 'bad', server_limit: 0 }, db);
    await updateEdgeProxy(8, { name: 'edge', evil: 'bad' }, db);
    assert.equal(calls[0].sql, 'UPDATE users SET username = $1, server_limit = $2 WHERE id = $3');
    assert.deepEqual(calls[0].parameters, ['safe', 0, 3]);
    assert.doesNotMatch(calls[1].sql, /evil/);
  });

  it('keeps backup and notification values parameterized', async () => {
    const calls = [];
    const db = async (sql, parameters) => { calls.push({ sql, parameters }); return { rows: [] }; };
    await recordBackup({ serverId: 's1', filename: "x'); DROP TABLE backups; --", sizeBytes: 42, checksumSha256: 'a'.repeat(64) }, db);
    await createNotification({ title: 'title', content: 'content' }, db);
    await listClientNotifications(5, db);
    assert.equal(calls[0].parameters[1], "x'); DROP TABLE backups; --");
    assert.equal(calls[0].parameters[3], 'a'.repeat(64));
    assert.deepEqual(calls[1].parameters, ['title', 'content', 'info', 'client']);
    assert.deepEqual(calls[2].parameters, [5]);
    assert.match(calls[2].sql, /audience IN \('client', 'all'\)/);
    assert.doesNotMatch(calls[2].sql, /title NOT LIKE/);
  });

  it('keeps administrative notifications out of the client audience', async () => {
    const calls = [];
    const db = async (sql, parameters) => { calls.push({ sql, parameters }); return { rows: [] }; };
    await createNotification({
      title: '[Seguridad] Contenedor huérfano detectado',
      content: 'internal runtime details',
      type: 'warning',
      audience: 'admin'
    }, db);
    assert.deepEqual(calls[0].parameters, [
      '[Seguridad] Contenedor huérfano detectado',
      'internal runtime details',
      'warning',
      'admin'
    ]);
    await assert.rejects(
      createNotification({ title: 'bad', content: 'bad', audience: 'public' }, db),
      /INVALID_NOTIFICATION_AUDIENCE/
    );
  });
});

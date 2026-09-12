import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimServerRecreation,
  findServerNodeIdByContainer,
  findSubuserPermissions
} from '../src/repositories/serverRepository.js';
import { listActiveNodeIds, updateNode } from '../src/repositories/nodeRepository.js';

describe('SQL repositories', () => {
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
});

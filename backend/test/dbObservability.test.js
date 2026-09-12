import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeObservedQuery, getDbMetrics, resetDbMetricsForTests } from '../src/db.js';

describe('PostgreSQL query observability', () => {
  beforeEach(() => resetDbMetricsForTests());

  it('records successful duration without retaining parameters', async () => {
    const clock = [10, 35];
    const result = await executeObservedQuery(async () => ({ rows: [{ ok: true }] }), 'SELECT secret FROM users WHERE id = $1', ['private'], () => clock.shift());
    assert.equal(result.rows[0].ok, true);
    const metrics = getDbMetrics();
    assert.equal(metrics.queries, 1);
    assert.equal(metrics.errors, 0);
    assert.equal(metrics.totalDurationMs, 25);
    assert.equal(JSON.stringify(metrics).includes('private'), false);
  });

  it('counts failures and rethrows the original database error', async () => {
    const failure = Object.assign(new Error('database unavailable'), { code: '57P01' });
    await assert.rejects(
      executeObservedQuery(async () => { throw failure; }, 'SELECT 1', [], (() => { const values = [1, 2]; return () => values.shift(); })()),
      failure
    );
    assert.equal(getDbMetrics().errors, 1);
  });
});

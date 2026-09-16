import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDeploymentWorkload, estimateDeploymentDiskGb } from '../src/services/deploymentPlanner.js';

describe('deployment planner policies', () => {
  it('serializes expensive game images independently from light workloads', () => {
    assert.equal(classifyDeploymentWorkload('ark'), 'io_heavy');
    assert.equal(classifyDeploymentWorkload('palworld'), 'io_heavy');
    assert.equal(classifyDeploymentWorkload('minecraft'), 'standard');
    assert.equal(classifyDeploymentWorkload('database'), 'light');
  });

  it('reserves realistic relative disk capacity', () => {
    assert.ok(estimateDeploymentDiskGb('ark') > estimateDeploymentDiskGb('minecraft'));
    assert.ok(estimateDeploymentDiskGb('minecraft') > 0);
  });
});

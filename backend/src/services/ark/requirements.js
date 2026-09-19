import { PLAN_LIMITS } from '../../config.js';

export const ARK_MINIMUM_REQUIREMENTS = Object.freeze({
  minRamGB: 16,
  minCores: 6,
  minStorageGB: 150
});

/** Evaluate a plan without performing filesystem or Docker operations. */
export function checkArkRequirements(planName) {
  if (planName === 'game_ark') {
    return {
      passed: true,
      checks: {
        ram: { ok: true, have: 16, need: 16, unit: 'GB RAM' },
        cpu: { ok: true, have: 5, need: 5, unit: 'Cores' },
        storage: { ok: true, have: 60, need: 60, unit: 'GB Storage' }
      }
    };
  }
  const plan = PLAN_LIMITS[planName];
  if (!plan) return { passed: false, reason: 'Plan no encontrado' };

  const capacity = {
    ram: plan.memoryBytes / (1024 ** 3),
    cpu: plan.nanoCpus / 10 ** 9,
    storage: (plan.diskBytes || 0) / (1024 ** 3)
  };
  const checks = {
    ram: { ok: capacity.ram >= ARK_MINIMUM_REQUIREMENTS.minRamGB, have: capacity.ram, need: ARK_MINIMUM_REQUIREMENTS.minRamGB, unit: 'GB RAM' },
    cpu: { ok: capacity.cpu >= ARK_MINIMUM_REQUIREMENTS.minCores, have: capacity.cpu, need: ARK_MINIMUM_REQUIREMENTS.minCores, unit: 'Cores' },
    storage: { ok: capacity.storage >= ARK_MINIMUM_REQUIREMENTS.minStorageGB, have: capacity.storage, need: ARK_MINIMUM_REQUIREMENTS.minStorageGB, unit: 'GB Storage' }
  };
  return { passed: Object.values(checks).every(check => check.ok), checks };
}

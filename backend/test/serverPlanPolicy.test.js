import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { config, PLAN_LIMITS } from '../src/config.js';
import {
  getEffectiveServerLimit,
  getPlanRamGb,
  getPortAllocationPolicy,
  isTemplateAllowed,
  normalizePlanKey,
  normalizeTemplateKey,
  resolveRequestedRamGb,
  resolveServerPlan
} from '../src/services/serverPlanPolicy.js';

describe('Politica central de planes y despliegue', () => {
  it('normaliza PARTNER y conserva sus limites aunque server_limit sea 1', () => {
    for (const value of ['partner', 'PARTNER', ' partner ', 'plan-partner']) {
      assert.equal(normalizePlanKey(value), 'partner');
    }
    const { plan } = resolveServerPlan(' PARTNER ');
    assert.equal(getEffectiveServerLimit(1, plan, 1), 10);
    assert.equal(getPlanRamGb(plan), 32);
  });

  it('usa hobby de forma segura para identificadores desconocidos', () => {
    const resolved = resolveServerPlan('plan-inexistente');
    assert.equal(resolved.key, 'hobby');
    assert.equal(resolved.plan, PLAN_LIMITS.hobby);
  });

  it('mantiene compatibilidad con identificadores legacy de Platinum', () => {
    assert.equal(normalizePlanKey('elite'), 'platinum');
    assert.equal(normalizePlanKey('plan_platinum'), 'platinum');
  });

  it('incluye los planes community que se guardan desde hosting_plans', () => {
    assert.equal(resolveServerPlan('community_starter').plan.maxSlots, 2);
    assert.equal(resolveServerPlan('community_pro').plan.maxSlots, 4);
    assert.equal(resolveServerPlan('community_network').plan.maxSlots, 8);
  });

  it('normaliza discord_bot y valida el catalogo autorizado', () => {
    assert.equal(normalizeTemplateKey('discord_bot'), 'discordbot');
    assert.equal(isTemplateAllowed(PLAN_LIMITS.ultimate, 'discord_bot'), true);
    assert.equal(isTemplateAllowed(PLAN_LIMITS.hobby, 'ark'), false);
  });

  it('valida RAM entera y los minimos por juego', () => {
    assert.equal(resolveRequestedRamGb(2, PLAN_LIMITS.partner, 'minecraft'), 2);
    assert.equal(resolveRequestedRamGb(undefined, PLAN_LIMITS.game_rust, 'rust'), 6);
    assert.equal(PLAN_LIMITS.game_rust.minRamGb, 6);
    assert.equal(resolveRequestedRamGb(undefined, PLAN_LIMITS.game_zomboid, 'zomboid'), 6);
    assert.equal(PLAN_LIMITS.game_zomboid.minRamGb, 6);
    assert.throws(
      () => resolveRequestedRamGb(4, PLAN_LIMITS.game_rust, 'rust'),
      /al menos 6 GB/
    );
    assert.throws(
      () => resolveRequestedRamGb(4, PLAN_LIMITS.game_zomboid, 'zomboid'),
      /al menos 6 GB/
    );
    assert.throws(
      () => resolveRequestedRamGb(2.5, PLAN_LIMITS.partner, 'minecraft'),
      /entero/
    );
  });

  it('asigna los inicios y rangos de puerto correctos', () => {
    assert.deepEqual(getPortAllocationPolicy('fivem', config), {
      start: config.fivemPortStart,
      range: 1,
      adminStart: config.txAdminPortStart
    });
    assert.deepEqual(getPortAllocationPolicy('rust', config), {
      start: config.rustPortStart,
      range: 3
    });
    assert.deepEqual(getPortAllocationPolicy('sdtd', config), {
      start: config.sdtdPortStart,
      range: 4
    });
    assert.deepEqual(getPortAllocationPolicy('database', config), {
      start: config.appPortStart,
      range: 1
    });
  });

  it('mantiene todos los juegos dentro de la banda aislada de cada entorno', () => {
    const expectedRanges = {
      fivem: 1,
      minecraft: 1,
      rust: 3,
      palworld: 3,
      cs2: 1,
      valheim: 3,
      zomboid: 2,
      ark: 14,
      sdtd: 4,
      discordbot: 1,
      wordpress: 1,
      database: 1
    };

    for (const [template, expectedRange] of Object.entries(expectedRanges)) {
      const policy = getPortAllocationPolicy(template, config);
      assert.equal(policy.range, expectedRange, `${template} debe reservar su bloque completo`);
      assert.ok(policy.range <= 1000, `${template} no puede invadir la banda del otro entorno`);
    }
  });
});

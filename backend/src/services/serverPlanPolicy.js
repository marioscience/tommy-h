import { PLAN_LIMITS } from '../config.js';

const GIB = 1024 ** 3;

const PLAN_ALIASES = Object.freeze({
  elite: 'platinum'
});

const TEMPLATE_ALIASES = Object.freeze({
  discord: 'discordbot',
  discord_bot: 'discordbot'
});

const TEMPLATE_MIN_RAM_GB = Object.freeze({
  fivem: 1,
  minecraft: 2,
  // RustDedicated exceeded a 4 GiB cgroup during normal startup/runtime in
  // production. Unlike a JVM workload it has no independent heap ceiling, so
  // the safe control is rejecting undersized allocations at provisioning.
  rust: 6,
  palworld: 8,
  cs2: 2,
  valheim: 2,
  // Project Zomboid Build 42 was repeatedly terminated by the production
  // cgroup OOM killer while loading a fresh world with a 4 GiB allocation.
  zomboid: 6,
  ark: 16,
  sdtd: 4,
  discordbot: 1,
  wordpress: 2,
  database: 1
});

function normalizeKey(value, fallback) {
  const normalized = String(value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return normalized || fallback;
}

export function normalizePlanKey(value) {
  const normalized = normalizeKey(value, 'hobby');
  if (Object.hasOwn(PLAN_LIMITS, normalized)) return normalized;

  const withoutPrefix = normalized.replace(/^plan_/, '');
  if (Object.hasOwn(PLAN_LIMITS, withoutPrefix)) return withoutPrefix;
  return PLAN_ALIASES[normalized] || PLAN_ALIASES[withoutPrefix] || 'hobby';
}

export function resolveServerPlan(value) {
  const key = normalizePlanKey(value);
  return { key, plan: PLAN_LIMITS[key] };
}

export function normalizeTemplateKey(value) {
  const normalized = normalizeKey(value, 'fivem');
  return TEMPLATE_ALIASES[normalized] || normalized;
}

export function isTemplateAllowed(plan, template) {
  const requested = normalizeTemplateKey(template);
  return (plan?.allowedTemplates || [])
    .map(normalizeTemplateKey)
    .includes(requested);
}

export function getEffectiveServerLimit(storedLimit, plan, fallbackLimit = 1) {
  const candidates = [storedLimit, fallbackLimit]
    .map(Number)
    .filter(value => Number.isInteger(value) && value > 0);
  const accountLimit = candidates[0] || candidates[1] || 1;
  const planLimit = Number.isInteger(Number(plan?.maxSlots)) && Number(plan.maxSlots) > 0
    ? Number(plan.maxSlots)
    : 1;
  return Math.max(accountLimit, planLimit);
}

export function getPlanRamGb(plan) {
  const bytes = Number(plan?.memoryBytes);
  return Number.isFinite(bytes) && bytes > 0 ? Math.max(1, Math.round(bytes / GIB)) : 1;
}

export function getMinimumRamGb(plan, template) {
  const planMinimum = Number(plan?.minRamGb) || 1;
  const templateMinimum = TEMPLATE_MIN_RAM_GB[normalizeTemplateKey(template)] || 1;
  return Math.max(planMinimum, templateMinimum);
}

export function resolveRequestedRamGb(value, plan, template) {
  const minimum = getMinimumRamGb(plan, template);
  const requested = value === undefined || value === null || value === '' ? minimum : Number(value);
  if (!Number.isInteger(requested) || requested < minimum) {
    throw new Error(`La asignacion de RAM debe ser un entero de al menos ${minimum} GB para ${normalizeTemplateKey(template).toUpperCase()}.`);
  }
  return requested;
}

export function getPortAllocationPolicy(template, runtimeConfig) {
  const normalized = normalizeTemplateKey(template);
  const policies = {
    minecraft: { start: runtimeConfig.minecraftPortStart, range: 1 },
    rust: { start: runtimeConfig.rustPortStart, range: 3 },
    palworld: { start: runtimeConfig.palworldPortStart, range: 3 },
    cs2: { start: runtimeConfig.cs2PortStart, range: 1 },
    valheim: { start: runtimeConfig.valheimPortStart, range: 3 },
    zomboid: { start: runtimeConfig.zomboidPortStart, range: 2 },
    ark: { start: runtimeConfig.arkPortStart, range: 14 },
    sdtd: { start: runtimeConfig.sdtdPortStart, range: 4 },
    discordbot: { start: runtimeConfig.appPortStart, range: 1 },
    wordpress: { start: runtimeConfig.appPortStart, range: 1 },
    database: { start: runtimeConfig.appPortStart, range: 1 }
  };

  if (normalized === 'fivem') {
    return {
      start: runtimeConfig.fivemPortStart,
      range: 1,
      adminStart: runtimeConfig.txAdminPortStart
    };
  }

  const policy = policies[normalized];
  if (!policy) throw new Error(`Tipo de servidor no soportado: ${normalized}.`);
  return policy;
}

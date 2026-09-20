import { z } from 'zod';

const safeIdentifier = z.string().trim().min(1).max(254);
const safePassword = z.string().min(1).max(128);
const templateName = z.string().trim().min(1).max(32).regex(/^[a-z0-9_-]+$/i);
const optionalNodeId = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/).transform(Number)]).optional();
const optionalRam = z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)]).optional();
const timeOfDay = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/);
const safeBackupFilename = z.string().trim().min(1).max(255).refine(
  (value) => value === value.split(/[\\/]/).at(-1),
  'Backup filename must not contain a path'
);

export const loginRequest = Object.freeze({
  body: z.object({
    username: safeIdentifier,
    password: safePassword
  }).strip()
});

export const registerRequest = Object.freeze({
  body: z.object({
    username: z.string().regex(/^[A-Za-z0-9_.-]{3,32}$/),
    email: z.string().trim().toLowerCase().email().max(254).or(z.literal('')).optional().default(''),
    password: z.string().min(8).max(128),
    inviteKey: z.string().min(1).max(128)
  }).strip()
});

// Game adapters own their template-specific options. This boundary validates
// the shared placement contract while preserving those adapter fields.
export const deploymentRequest = Object.freeze({
  body: z.object({
    template: templateName.optional().default('fivem'),
    allocatedRamGb: optionalRam,
    nodeId: optionalNodeId,
    explicitNodeId: optionalNodeId,
    name: z.string().trim().min(1).max(80).optional(),
    licenseKey: z.string().max(4096).optional()
  }).passthrough()
});

export const idempotencyRequest = z.string().trim().max(128);

export const backupCreateRequest = Object.freeze({
  body: z.object({
    customName: z.string().trim().max(80).optional()
  }).strip()
});

export const backupRestoreRequest = Object.freeze({
  body: z.object({ filename: safeBackupFilename }).strip()
});

export const backupScheduleRequest = Object.freeze({
  body: z.object({ time: timeOfDay }).strip()
});

export const commandRequest = Object.freeze({
  body: z.object({ command: z.string().trim().min(1).max(256) }).strip()
});

export const subuserRequest = Object.freeze({
  body: z.object({
    usernameOrEmail: safeIdentifier,
    permissions: z.array(z.enum(['start', 'stop', 'restart', 'console', 'files', 'settings', 'backups'])).max(7).optional()
  }).strip()
});

export const webhookRequest = Object.freeze({
  body: z.object({
    webhookUrl: z.union([
      z.literal(''),
      z.string().url().startsWith('https://discord.com/api/webhooks/').max(2048)
    ]).optional(),
    events: z.array(z.enum(['online', 'offline', 'player_join', 'player_leave', 'update'])).max(5).optional()
  }).strip()
});

export const clusterRequest = Object.freeze({
  body: z.object({
    clusterId: z.union([z.null(), z.literal(''), z.string().trim().max(80).regex(/^[a-zA-Z0-9_-]+$/)]).optional()
  }).strip()
});

export const autoRestartRequest = Object.freeze({
  body: z.object({
    time: timeOfDay.optional(),
    enabled: z.boolean(),
    backupBeforeRestart: z.boolean().optional()
  }).refine((value) => !value.enabled || Boolean(value.time), { path: ['time'] }).strip()
});

export const autoInstallRequest = Object.freeze({
  body: z.object({ type: z.enum(['npm', 'pip']).optional().default('npm') }).strip()
});

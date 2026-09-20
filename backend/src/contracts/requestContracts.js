import { z } from 'zod';

const safeIdentifier = z.string().trim().min(1).max(254);
const safePassword = z.string().min(1).max(128);
const templateName = z.string().trim().min(1).max(32).regex(/^[a-z0-9_-]+$/i);
const optionalNodeId = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/).transform(Number)]).optional();
const optionalRam = z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)]).optional();

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


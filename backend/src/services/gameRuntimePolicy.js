import crypto from 'crypto';
import { config } from '../config.js';

export function deriveServicePassword(scope, identifier) {
  return crypto.createHmac('sha256', config.jwtSecret)
    .update(`${scope}:${identifier}`)
    .digest('base64url')
    .slice(0, 32);
}

export function deriveServiceIdentifier(scope, identifier, maxLength = 32) {
  const normalizedScope = String(scope || 'server').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const suffix = crypto.createHash('sha256')
    .update(`${normalizedScope}:${identifier}`)
    .digest('hex')
    .slice(0, 10);
  return `${normalizedScope}-${suffix}`.slice(0, Math.max(12, maxLength));
}

export const GAME_SECURITY_CONFIG = {
  SecurityOpt: ['no-new-privileges:true'],
  CapDrop: ['ALL'],
  CapAdd: ['CHOWN', 'FOWNER', 'SETUID', 'SETGID', 'NET_BIND_SERVICE', 'KILL', 'DAC_OVERRIDE', 'DAC_READ_SEARCH'],
  LogConfig: {
    Type: 'json-file',
    Config: { 'max-size': '20m', 'max-file': '3' }
  }
};

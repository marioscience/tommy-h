import { config } from '../config.js';

function normalizeHost(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'localhost';

  try {
    const parsed = new URL(raw.includes('://') ? raw : `http://${raw}`);
    return parsed.hostname;
  } catch {
    return raw.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0] || 'localhost';
  }
}

function normalizeScheme(value) {
  return String(value || '').toLowerCase() === 'https' ? 'https' : 'http';
}

function normalizeMode(value) {
  return String(value || '').toLowerCase() === 'subdomain' ? 'subdomain' : 'port';
}

function normalizePrefix(value) {
  const prefix = String(value || 'tx').trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,15}$/.test(prefix)) {
    throw new Error(`Prefijo de endpoint publico invalido: ${value}`);
  }
  return prefix;
}

export function getPublicEndpointUrl(port, options = {}) {
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    throw new Error(`Puerto publico invalido: ${port}`);
  }

  const host = normalizeHost(options.host || config.publicEndpointHost);
  const scheme = normalizeScheme(options.scheme || config.publicEndpointScheme);
  const mode = normalizeMode(options.mode || config.publicEndpointMode);
  const pathname = options.path === undefined ? '/' : String(options.path);
  const suffix = pathname ? `/${pathname.replace(/^\/+/, '')}` : '';

  if (mode === 'subdomain') {
    const prefix = normalizePrefix(options.prefix || config.publicEndpointPrefix);
    return `${scheme}://${prefix}${numericPort}.${host}${suffix}`;
  }

  return `${scheme}://${host}:${numericPort}${suffix}`;
}

import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query, queryCached } from '../db.js';

export function signToken(user) {
  return jwt.sign(
    { 
      sub: user.id, 
      username: user.username, 
      role: user.role,
      version: user.token_version || 0 
    }, 
    config.jwtSecret, 
    { expiresIn: '24h' }
  );
}

const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

function getCookie(req, name) {
  for (const cookie of String(req.headers.cookie || '').split(';')) {
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(cookie.slice(separator + 1).trim()); } catch { return ''; }
  }
  return '';
}

function buildSessionCookie(value, maxAge, isSecure = true) {
  const sameSite = ['Strict', 'Lax', 'None'].includes(config.cookieSameSite) ? config.cookieSameSite : 'Lax';
  const parts = [
    `${config.sessionCookieName}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'Path=/',
    `SameSite=${sameSite}`,
    `Max-Age=${maxAge}`
  ];
  if (config.cookieSecure && isSecure) parts.push('Secure');
  return parts.join('; ');
}

export function setSessionCookie(res, token, req) {
  const isSecure = req ? (req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https') : true;
  res.append('Set-Cookie', buildSessionCookie(token, SESSION_MAX_AGE_SECONDS, isSecure));
}

export function clearSessionCookie(res, req) {
  const isSecure = req ? (req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https') : true;
  res.append('Set-Cookie', buildSessionCookie('', 0, isSecure));
}

export function hasSessionCookie(req) {
  return Boolean(getCookie(req, config.sessionCookieName));
}

export async function requireAuth(req, res, next) {
  const authorization = req.headers.authorization || '';
  const cookieToken = getCookie(req, config.sessionCookieName);
  const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const token = cookieToken || bearerToken;

  if (!token || typeof token !== 'string' || token.length > 4096) return res.status(401).json({ error: 'No autenticado' });
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    const result = await query('SELECT id, token_version FROM users WHERE id = $1', [payload.sub]);
    
    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado.' });
    }

    const user = result.rows[0];
    const dbVersion = Number(user.token_version || 0);
    const tokenVersion = Number(payload.version || 0);
    
    if (tokenVersion !== dbVersion) {
      return res.status(401).json({ error: 'La sesión ha sido invalidada (contraseña cambiada).' });
    }

    req.user = payload;
    req.authSource = cookieToken ? 'cookie' : 'bearer';
    next();
  } catch (e) { 
    if (cookieToken) clearSessionCookie(res);
    res.status(401).json({ error: 'Token inválido o expirado.' }); 
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Prohibido. Requiere Admin.' });
  next();
}

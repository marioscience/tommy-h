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

export async function requireAuth(req, res, next) {
  let token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token && req.query.token) token = req.query.token;

  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    
    // 🔥 MEJORA DE SEGURIDAD Y RENDIMIENTO: Caché de 10s en Redis para validación JWT
    const result = await queryCached('SELECT id, token_version FROM users WHERE id = $1', [payload.sub], 10);
    
    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado.' });
    }

    const user = result.rows[0];
    
    // Si el payload no tiene versión (token antiguo) o no coincide con la DB (contraseña cambiada)
    if (payload.version === undefined || payload.version !== user.token_version) {
      return res.status(401).json({ error: 'La sesión ha sido invalidada (contraseña cambiada).' });
    }

    req.user = payload;
    next();
  } catch (e) { 
    res.status(401).json({ error: 'Token inválido o expirado.' }); 
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Prohibido. Requiere Admin.' });
  next();
}

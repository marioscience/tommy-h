import crypto from 'crypto';
import { config } from '../config.js';

/**
 * Authenticates calls made by the Discord bot.
 *
 * Both values are hashed to keep comparison time independent from the key
 * length. Keeping this policy in middleware prevents bot routes from
 * implementing subtly different authentication rules.
 */
export function verifyDiscordApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const received = crypto.createHash('sha256').update(String(apiKey || '')).digest();
  const expected = crypto.createHash('sha256').update(String(config.discordApiKey || '')).digest();

  if (!apiKey || !crypto.timingSafeEqual(received, expected)) {
    console.warn(`Intento de acceso bloqueado a la API del bot desde IP: ${req.ip}`);
    return res.status(401).json({ error: 'Acceso denegado. API Key inválida.' });
  }

  next();
}

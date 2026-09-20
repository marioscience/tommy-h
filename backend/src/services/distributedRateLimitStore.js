import { MemoryStore } from 'express-rate-limit';
import { ensureRedis, redisClient } from '../db.js';
import { logger } from '../utils/logger.js';

const INCREMENT_SCRIPT = `
local value = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { value, ttl }
`;

/**
 * express-rate-limit store backed by the shared Redis service.
 *
 * Redis keeps security limits consistent across API replicas. The in-process
 * store is an availability fallback only; recovery is logged so operators can
 * detect that limits are temporarily per replica.
 */
export class DistributedRateLimitStore {
  constructor(prefix) {
    this.prefix = `ragenodes:ratelimit:${prefix}:`;
    this.localFallback = new MemoryStore();
    this.localModeLogged = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
    this.localFallback.init(options);
  }

  async increment(key) {
    try {
      await ensureRedis();
      if (!redisClient.isOpen) throw new Error('Redis no disponible');
      const [totalHits, ttlMs] = await redisClient.eval(INCREMENT_SCRIPT, {
        keys: [`${this.prefix}${key}`],
        arguments: [String(this.windowMs)]
      });
      this.localModeLogged = false;
      return { totalHits: Number(totalHits), resetTime: new Date(Date.now() + Number(ttlMs)) };
    } catch (error) {
      if (!this.localModeLogged && process.env.NODE_ENV !== 'test') {
        logger.error({ err: error, prefix: this.prefix }, 'Rate limit en modo local degradado; Redis no está disponible.');
        this.localModeLogged = true;
      }
      return this.localFallback.increment(key);
    }
  }

  async decrement(key) {
    try {
      if (redisClient.isOpen) {
        await redisClient.decr(`${this.prefix}${key}`);
        return;
      }
    } catch {}
    await this.localFallback.decrement(key);
  }

  async resetKey(key) {
    try {
      if (redisClient.isOpen) await redisClient.del(`${this.prefix}${key}`);
    } finally {
      await this.localFallback.resetKey(key);
    }
  }
}

export function distributedRateLimitStore(prefix) {
  return new DistributedRateLimitStore(prefix);
}

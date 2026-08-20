import crypto from 'crypto';
import { logger } from '../utils/logger.js';

export function requestLogger(req, res, next) {
  // 1. Resolver o generar Correlation ID (Request ID)
  const incomingId = req.headers['x-request-id'] || req.headers['x-correlation-id'];
  const reqId = typeof incomingId === 'string' && incomingId.trim().length > 0 && incomingId.length <= 64
    ? incomingId.trim()
    : crypto.randomUUID();

  req.id = reqId;
  res.setHeader('X-Request-ID', reqId);

  // 2. Inyectar logger contextual en la petición
  req.log = logger.child({ reqId, path: req.path, method: req.method });

  const startAt = process.hrtime.bigint();

  // 3. Registrar al completar la respuesta HTTP
  res.on('finish', () => {
    // Omitir logging ruidoso en sonadas periódicas de healthcheck en producción
    if (req.path === '/healthz' && res.statusCode === 200 && process.env.NODE_ENV === 'production') {
      return;
    }

    const durationNs = process.hrtime.bigint() - startAt;
    const durationMs = Math.round(Number(durationNs) / 10000) / 100; // 2 decimales

    const logData = {
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      duration_ms: durationMs,
      ip: req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
      userId: req.user?.sub || undefined
    };

    const logMsg = `HTTP ${req.method} ${req.originalUrl || req.url} ${res.statusCode} (${durationMs}ms)`;

    if (res.statusCode >= 500) {
      req.log.error(logData, logMsg);
    } else if (res.statusCode >= 400) {
      req.log.warn(logData, logMsg);
    } else {
      req.log.info(logData, logMsg);
    }
  });

  next();
}

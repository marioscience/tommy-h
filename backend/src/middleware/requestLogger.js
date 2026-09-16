import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

export function requestLogger(req, res, next) {
  // 1. Resolver o generar Correlation ID (Request ID)
  const incomingId = req.headers['x-request-id'] || req.headers['x-correlation-id'];
  const reqId = typeof incomingId === 'string' && incomingId.trim().length > 0 && incomingId.length <= 64
    ? incomingId.trim()
    : crypto.randomUUID();

  req.id = reqId;
  res.setHeader('X-Request-ID', reqId);

  if (config.clientDebugLogging) {
    res.setHeader('X-Debug-Mode', 'enabled');
    if (config.nodeEnv === 'production') {
      res.setHeader('X-Debug-Warning', 'DEBUG-ENABLED-IN-PRODUCTION');
    }
  }

  // 2. Inyectar logger contextual en la petición
  req.log = logger.child({ reqId, path: req.path, method: req.method });

  const startAt = process.hrtime.bigint();
  const originalJson = res.json.bind(res);

  res.json = (body) => {
      if (body && typeof body === 'object') {
        if (body.error) {
          res.locals.errorMessage = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
        } else if (body.message && res.statusCode >= 400) {
          res.locals.errorMessage = typeof body.message === 'string' ? body.message : JSON.stringify(body.message);
        }
      }
      return originalJson(body);
    };

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



    if (res.locals.errorMessage) {
      logData.errorMessage = res.locals.errorMessage;
    }

    const errorSuffix = res.locals.errorMessage ? ` - Error: "${res.locals.errorMessage}"` : '';
    const logMsg = `HTTP ${req.method} ${req.originalUrl || req.url} ${res.statusCode} (${durationMs}ms)${errorSuffix}`;

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

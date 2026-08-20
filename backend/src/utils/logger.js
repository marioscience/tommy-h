import crypto from 'crypto';

const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50
};

const currentLogLevelName = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')).toLowerCase();
const currentLogLevel = LOG_LEVELS[currentLogLevelName] ?? LOG_LEVELS.info;
const isJsonOutput = process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';

function serializeError(err) {
  if (!err) return undefined;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: err.code,
      statusCode: err.statusCode || err.status
    };
  }
  return { message: String(err) };
}

export class Logger {
  constructor(defaultContext = {}) {
    this.defaultContext = defaultContext;
  }

  child(additionalContext = {}) {
    return new Logger({
      ...this.defaultContext,
      ...additionalContext
    });
  }

  _log(levelName, firstArg, secondArg) {
    const levelWeight = LOG_LEVELS[levelName] ?? LOG_LEVELS.info;
    if (levelWeight < currentLogLevel) return;

    let message = '';
    let context = {};

    if (typeof firstArg === 'string') {
      message = firstArg;
      if (typeof secondArg === 'object' && secondArg !== null) {
        context = secondArg;
      }
    } else if (firstArg instanceof Error) {
      context = { err: serializeError(firstArg) };
      message = typeof secondArg === 'string' ? secondArg : firstArg.message;
    } else if (typeof firstArg === 'object' && firstArg !== null) {
      context = { ...firstArg };
      if (context.err || context.error) {
        context.err = serializeError(context.err || context.error);
        delete context.error;
      }
      message = typeof secondArg === 'string' ? secondArg : (context.msg || context.message || '');
      delete context.msg;
      delete context.message;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      level: levelName,
      ...this.defaultContext,
      ...context,
      message: message || undefined
    };

    if (isJsonOutput) {
      const output = JSON.stringify(payload);
      if (levelWeight >= LOG_LEVELS.error) {
        process.stderr.write(output + '\n');
      } else {
        process.stdout.write(output + '\n');
      }
    } else {
      const time = payload.timestamp.slice(11, 19);
      const prefix = `[${time}] [${levelName.toUpperCase().padEnd(5)}]`;
      const reqId = payload.reqId ? ` [req:${payload.reqId.slice(0, 8)}]` : '';
      const mod = payload.module ? ` [${payload.module}]` : '';
      const contextKeys = Object.keys(payload).filter(k => !['timestamp', 'level', 'message', 'reqId', 'module', 'err'].includes(k));
      const contextStr = contextKeys.length > 0 ? ` ${JSON.stringify(Object.fromEntries(contextKeys.map(k => [k, payload[k]])))}` : '';
      
      const formattedLine = `${prefix}${reqId}${mod} ${message || ''}${contextStr}`;

      if (levelWeight >= LOG_LEVELS.error) {
        console.error(formattedLine);
        if (payload.err?.stack) console.error(payload.err.stack);
      } else if (levelWeight >= LOG_LEVELS.warn) {
        console.warn(formattedLine);
      } else {
        console.log(formattedLine);
      }
    }

    return payload;
  }

  debug(firstArg, secondArg) { return this._log('debug', firstArg, secondArg); }
  info(firstArg, secondArg) { return this._log('info', firstArg, secondArg); }
  warn(firstArg, secondArg) { return this._log('warn', firstArg, secondArg); }
  error(firstArg, secondArg) { return this._log('error', firstArg, secondArg); }
  fatal(firstArg, secondArg) { return this._log('fatal', firstArg, secondArg); }
}

export const logger = new Logger({ service: 'backend-api' });

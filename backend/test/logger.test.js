import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Logger } from '../src/utils/logger.js';
import { requestLogger } from '../src/middleware/requestLogger.js';
import { EventEmitter } from 'events';

describe('📜 Structured JSON Logger & Request Correlation Tests', () => {
    it('debería instanciar Logger y formatear payloads con timestamp y nivel', () => {
        const testLogger = new Logger({ service: 'unit-test' });
        const payload = testLogger.info('Servidor inicializado correctamente');

        assert.ok(payload);
        assert.equal(payload.service, 'unit-test');
        assert.equal(payload.level, 'info');
        assert.equal(payload.message, 'Servidor inicializado correctamente');
        assert.ok(payload.timestamp, 'Debe incluir timestamp ISO');
    });

    it('debería serializar objetos de Error correctamente con stack y mensaje', () => {
        const testLogger = new Logger();
        const testError = new Error('Fallo de conexión a Docker');
        testError.code = 'ECONNREFUSED';

        const payload = testLogger.error(testError, 'Error al conectar');

        assert.ok(payload);
        assert.equal(payload.level, 'error');
        assert.equal(payload.message, 'Error al conectar');
        assert.ok(payload.err, 'Debe incluir el objeto err serializado');
        assert.equal(payload.err.name, 'Error');
        assert.equal(payload.err.message, 'Fallo de conexión a Docker');
        assert.equal(payload.err.code, 'ECONNREFUSED');
        assert.ok(payload.err.stack, 'Debe incluir el stack trace');
    });

    it('debería heredar y fusionar contexto en child loggers', () => {
        const rootLogger = new Logger({ app: 'ragenodes', env: 'production' });
        const childLogger = rootLogger.child({ module: 'ServerService', serverId: 'srv-123' });

        const payload = childLogger.warn('Límite de memoria cercano');

        assert.equal(payload.app, 'ragenodes');
        assert.equal(payload.env, 'production');
        assert.equal(payload.module, 'ServerService');
        assert.equal(payload.serverId, 'srv-123');
        assert.equal(payload.message, 'Límite de memoria cercano');
    });

    it('el middleware requestLogger debe inyectar req.id, req.log y cabecera X-Request-ID', () => {
        const req = {
            headers: {},
            method: 'GET',
            path: '/api/servers',
            url: '/api/servers',
            ip: '192.168.1.50'
        };

        const headersSent = {};
        const res = new EventEmitter();
        res.setHeader = (key, val) => { headersSent[key] = val; };
        res.statusCode = 200;

        let nextCalled = false;
        requestLogger(req, res, () => { nextCalled = true; });

        assert.ok(nextCalled, 'Debe invocar next()');
        assert.ok(req.id, 'Debe generar un req.id');
        assert.equal(headersSent['X-Request-ID'], req.id, 'Debe setear la cabecera X-Request-ID');
        assert.ok(req.log instanceof Logger, 'Debe inyectar una instancia de child Logger en req.log');

        // Simular finalización de petición HTTP
        res.emit('finish');
    });

    it('el middleware requestLogger debe respetar un X-Request-ID existente enviado por el cliente', () => {
        const clientReqId = 'custom-correlation-id-9988';
        const req = {
            headers: { 'x-request-id': clientReqId },
            method: 'POST',
            path: '/api/auth/login',
            url: '/api/auth/login'
        };

        const headersSent = {};
        const res = new EventEmitter();
        res.setHeader = (key, val) => { headersSent[key] = val; };
        res.statusCode = 200;

        requestLogger(req, res, () => {});

        assert.equal(req.id, clientReqId, 'Debe reutilizar el correlation ID provisto');
        assert.equal(headersSent['X-Request-ID'], clientReqId);
    });
});

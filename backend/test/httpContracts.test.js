import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import authRouter from '../src/routes/auth.js';
import adminNodesRouter from '../src/routes/adminNodes.js';
import serverRouter from '../src/routes/servers.js';

function handler(router, method, path) {
  const layer = router.stack.find((candidate) => candidate.route?.path === path && candidate.route.methods[method]);
  assert.ok(layer, `missing ${method.toUpperCase()} ${path}`);
  return layer.route.stack.at(-1).handle;
}

async function invokeRoute(router, method, path, req, res) {
  const layer = router.stack.find((candidate) => candidate.route?.path === path && candidate.route.methods[method]);
  assert.ok(layer, `missing ${method.toUpperCase()} ${path}`);
  let index = 0;
  const next = async (error) => {
    if (error) throw error;
    const entry = layer.route.stack[index++];
    if (entry) return entry.handle(req, res, next);
  };
  return next();
}

function responseRecorder() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    send(payload) { this.payload = payload; return this; }
  };
}

describe('Critical HTTP contracts', () => {
  it('rejects malformed login credentials with 401 and the stable public error', async () => {
    const res = responseRecorder();
    await invokeRoute(authRouter, 'post', '/login', { body: { username: '', password: '' } }, res);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.payload, { error: 'Credenciales inválidas' });
  });

  it('rejects malformed deployment payloads before infrastructure is called', async () => {
    const res = responseRecorder();
    await invokeRoute(serverRouter, 'post', '/', {
      body: { template: '../rust', allocatedRamGb: -1 },
      user: { sub: 1, role: 'client' },
      get: () => ''
    }, res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.payload, { error: 'Datos de solicitud inválidos.' });
  });

  it('normalizes shared deployment values while preserving adapter options', async () => {
    const route = serverRouter.stack.find((candidate) => candidate.route?.path === '/' && candidate.route.methods.post);
    const middleware = route.route.stack[0].handle;
    const req = {
      body: { template: 'rust', allocatedRamGb: '8', nodeId: '2', customAdapterFlag: true }
    };
    let continued = false;
    middleware(req, responseRecorder(), () => { continued = true; });
    assert.equal(continued, true);
    assert.deepEqual(req.body, {
      template: 'rust',
      allocatedRamGb: 8,
      nodeId: 2,
      customAdapterFlag: true
    });
  });

  it('rejects incomplete node creation before touching infrastructure', async () => {
    const res = responseRecorder();
    await handler(adminNodesRouter, 'post', '/nodes')({ body: {}, params: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.payload, { error: 'Faltan campos' });
  });

  it('requires a backup schedule time with the established 400 response', async () => {
    const res = responseRecorder();
    await handler(serverRouter, 'post', '/:id/backup-time')({ body: {}, params: { id: 'server' }, user: { sub: 1, role: 'client' } }, res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.payload, { error: 'Falta el campo time' });
  });
});

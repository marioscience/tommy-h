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
    await handler(authRouter, 'post', '/login')({ body: { username: '', password: '' } }, res);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.payload, { error: 'Credenciales inválidas' });
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

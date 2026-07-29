const { describe, it, after } = require('node:test');
const assert = require('node:assert');

const app = require('../src/app');
const server = app.listen(0);

after(() => server.close());

describe('app', () => {
  it('creates an Express application instance', () => {
    assert.strictEqual(typeof app, 'function');
    assert.strictEqual(app.name, 'express');
  });

  it('responds to root route with project info', async () => {
    const res = await fetch(`http://localhost:${server.address().port}/`);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.project, 'Equipchain');
    assert.strictEqual(data.status, 'Monitoring Meters');
    assert.ok(data.contract);
  });

  it('responds to health check route', async () => {
    const res = await fetch(`http://localhost:${server.address().port}/health`);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.status, 'ok');
    assert.ok(data.timestamp);
  });

  it('returns 404 for non-existent routes', async () => {
    const res = await fetch(`http://localhost:${server.address().port}/non-existent-route`);
    assert.strictEqual(res.status, 404);

    const data = await res.json();
    assert.strictEqual(data.error, 'Not Found');
  });

  it('includes correlation ID header in response', async () => {
    const res = await fetch(`http://localhost:${server.address().port}/`);
    assert.ok(res.headers.get('x-correlation-id'));
  });

  it('uses provided correlation ID from header', async () => {
    const testCorrelationId = 'test-correlation-id-123';
    const res = await fetch(`http://localhost:${server.address().port}/`, {
      headers: { 'x-correlation-id': testCorrelationId },
    });
    
    assert.strictEqual(res.headers.get('x-correlation-id'), testCorrelationId);
  });
});

const assert = require('node:assert');
const test = require('node:test');
const { buildOpenApiSpec } = require('../src/docs/openapi');

test('buildOpenApiSpec returns a valid OpenAPI 3 document', () => {
  const spec = buildOpenApiSpec();
  assert.strictEqual(spec.openapi, '3.0.3');
  assert.ok(spec.info && spec.info.title, 'info.title should exist');
  assert.ok(spec.paths && typeof spec.paths === 'object', 'paths should be an object');
  assert.ok(spec.components.securitySchemes.bearerAuth, 'bearerAuth scheme should exist');
});

test('documents the root, health, analytics, and exports endpoints', () => {
  const spec = buildOpenApiSpec();
  const paths = Object.keys(spec.paths);

  assert.ok(paths.includes('/'), 'root path should be documented');
  assert.ok(paths.includes('/health'), 'health path should be documented');
  assert.ok(
    paths.some((p) => p.startsWith('/api/analytics/')),
    'analytics endpoints should be documented'
  );
  assert.ok(
    paths.some((p) => p.startsWith('/api/exports/')),
    'exports endpoints should be documented'
  );
});

test('exposes a documented WebSocket connection count admin endpoint', () => {
  const spec = buildOpenApiSpec();
  const paths = Object.keys(spec.paths);
  assert.ok(
    paths.some((p) => p.includes('ws-connections')),
    'ws-connections endpoint should be documented'
  );
});

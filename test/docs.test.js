const assert = require('node:assert');
const test = require('node:test');
const http = require('node:http');
const express = require('express');
const docsRoutes = require('../src/routes/docs');

function request(app, method, urlPath) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const req = http.request(
        { host: '127.0.0.1', port, path: urlPath, method },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            server.close(() => resolve({ status: res.statusCode, body, headers: res.headers }));
          });
        }
      );
      req.on('error', reject);
      req.end();
    });
  });
}

test('GET /openapi.json returns the generated spec', async () => {
  const app = express();
  app.use('/api', docsRoutes);
  const res = await request(app, 'GET', '/api/openapi.json');
  assert.strictEqual(res.status, 200);
  const spec = JSON.parse(res.body);
  assert.strictEqual(spec.openapi, '3.0.3');
  assert.ok(Object.keys(spec.paths).length > 0);
});

test('GET /docs serves the Swagger UI page', async () => {
  const app = express();
  app.use('/api', docsRoutes);
  const res = await request(app, 'GET', '/api/docs/');
  assert.strictEqual(res.status, 200);
  assert.match(res.headers['content-type'], /html/);
});

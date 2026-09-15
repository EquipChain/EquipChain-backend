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

test('Swagger UI points at the live /api/openapi.json instead of a mount-time snapshot', async () => {
  const app = express();
  app.use('/api', docsRoutes);

  const page = await request(app, 'GET', '/api/docs/');
  assert.strictEqual(page.status, 200);

  // swagger-ui-express renders the bootstrap options into the
  // swagger-ui-init.js asset; the initializer copies customOptions (which
  // carries our url) into the SwaggerUIBundle options before init.
  const init = await request(app, 'GET', '/api/docs/swagger-ui-init.js');
  assert.strictEqual(init.status, 200);

  // setup() used to embed buildOpenApiSpec() output at mount time, so the
  // UI silently missed every endpoint registered after the docs router -
  // while /api/openapi.json served them fine. Asserting the initializer
  // references the live endpoint (and does NOT embed a spec snapshot)
  // pins the no-drift contract.
  assert.match(init.body, /api\/openapi\.json/);
  assert.doesNotMatch(init.body, /securitySchemes/);
});

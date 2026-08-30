const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

// We'll test the app by importing it and creating a test server
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-integration-tests';

const app = require('../index');

describe('API Integration Tests', () => {
  let server;
  let baseUrl;

  before(async () => {
    // Start a test server on a random port
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  function makeRequest(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const options = {
        method,
        hostname: 'localhost',
        port: server.address().port,
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        });
      });

      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  describe('Health Check', () => {
    test('GET /api/health should return 200', async () => {
      const res = await makeRequest('GET', '/api/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'healthy');
      assert.ok(res.body.uptime);
    });

    test('GET / should return project info', async () => {
      const res = await makeRequest('GET', '/');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.project, 'Equipchain');
      assert.ok(res.body.contract);
    });
  });

  describe('Auth Challenge', () => {
    test('POST /api/auth/challenge should return token', async () => {
      const res = await makeRequest('POST', '/api/auth/challenge', { wallet: 'test-wallet' });
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.token);
      assert.ok(res.body.token.includes('test-wallet'));
    });

    test('POST /api/auth/challenge should work without wallet', async () => {
      const res = await makeRequest('POST', '/api/auth/challenge', {});
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.token.includes('anonymous'));
    });
  });

  describe('Protected Route', () => {
    test('GET /api/protected should return 401 without auth', async () => {
      const res = await makeRequest('GET', '/api/protected');
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'Unauthorized');
    });

    test('GET /api/protected should return 401 with invalid auth', async () => {
      const res = await makeRequest('GET', '/api/protected', null, {
        Authorization: 'Invalid format',
      });
      assert.strictEqual(res.status, 401);
    });
  });

  describe('Analytics Routes', () => {
    test('GET /api/analytics/daily-summary should validate query params', async () => {
      const res = await makeRequest('GET', '/api/analytics/daily-summary');
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'Validation failed');
    });

    test('GET /api/analytics/fleet-summary should return data', async () => {
      const res = await makeRequest('GET', '/api/analytics/fleet-summary');
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.fleet);
    });
  });

  describe('Export Routes', () => {
    test('GET /api/exports/readings should require auth', async () => {
      const res = await makeRequest('GET', '/api/exports/readings');
      assert.strictEqual(res.status, 401);
    });

    test('GET /api/exports/readings should validate format', async () => {
      const res = await makeRequest('GET', '/api/exports/readings?format=csv', null, {
        Authorization: 'Bearer test-token',
      });
      // Should succeed or return validation error for format
      assert.ok([200, 400].includes(res.status));
    });
  });

  describe('Admin Routes', () => {
    test('GET /api/admin/users should require auth', async () => {
      const res = await makeRequest('GET', '/api/admin/users');
      assert.strictEqual(res.status, 401);
    });

    test('POST /api/admin/users should validate body', async () => {
      const res = await makeRequest('POST', '/api/admin/users', {
        // Missing required fields
      }, {
        Authorization: 'Bearer test-token',
      });
      // Should return 403 (no admin role) or 400 (validation failed)
      assert.ok([400, 403].includes(res.status));
    });
  });

  describe('404 Handler', () => {
    test('GET /nonexistent should return 404', async () => {
      const res = await makeRequest('GET', '/nonexistent');
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'Not Found');
    });
  });
});

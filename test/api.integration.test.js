const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const jwt = require('jsonwebtoken');

// We'll test the app by importing it and creating a test server
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-integration-tests';

// Exports and admin routes enforce real JWT auth, so mint tokens for the
// roles the assertions need (previously any Bearer string was accepted).
const userToken = jwt.sign(
  { sub: 'integration-tester', roles: ['user'] },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);
const adminToken = jwt.sign(
  { sub: 'integration-tester', roles: ['admin'] },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

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
    test('POST /api/auth/challenge mints a real verifiable JWT', async () => {
      const res = await makeRequest('POST', '/api/auth/challenge', { wallet: 'test-wallet' });
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.token);
      // The token must verify against the server secret and carry claims.
      const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
      assert.strictEqual(decoded.sub, 'test-wallet');
      assert.strictEqual(decoded.dev_challenge, true);
    });

    test('POST /api/auth/challenge should work without wallet', async () => {
      const res = await makeRequest('POST', '/api/auth/challenge', {});
      assert.strictEqual(res.status, 200);
      const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
      assert.strictEqual(decoded.sub, 'anonymous');
    });
  });

  describe('Protected Route', () => {
    test('GET /api/protected should return 401 without auth', async () => {
      const res = await makeRequest('GET', '/api/protected');
      assert.strictEqual(res.status, 401);
    });

    test('GET /api/protected should return 401 with invalid auth', async () => {
      const res = await makeRequest('GET', '/api/protected', null, {
        Authorization: 'Invalid format',
      });
      assert.strictEqual(res.status, 401);
    });

    test('GET /api/protected should return 401 for a garbage Bearer token', async () => {
      const res = await makeRequest('GET', '/api/protected', null, {
        Authorization: 'Bearer not-a-real-token',
      });
      assert.strictEqual(res.status, 401);
    });

    test('GET /api/protected accepts the token the challenge endpoint mints', async () => {
      const challenge = await makeRequest('POST', '/api/auth/challenge', { wallet: 'flow-user' });
      assert.strictEqual(challenge.status, 200);
      const res = await makeRequest('GET', '/api/protected', null, {
        Authorization: `Bearer ${challenge.body.token}`,
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.user, 'flow-user');
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
        Authorization: `Bearer ${userToken}`,
      });
      // Should succeed or return validation error for format
      assert.ok([200, 400].includes(res.status));
    });

    test('GET /api/exports/readings should reject forged tokens', async () => {
      const res = await makeRequest('GET', '/api/exports/readings?format=csv', null, {
        Authorization: 'Bearer test-token',
      });
      assert.strictEqual(res.status, 401);
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
        Authorization: `Bearer ${adminToken}`,
      });
      // Admin token present -> body validation fires with 400
      assert.strictEqual(res.status, 400);
    });

    test('POST /api/admin/users should reject non-admin roles', async () => {
      const res = await makeRequest('POST', '/api/admin/users', {
        email: 'x@example.com',
        name: 'X',
      }, {
        Authorization: `Bearer ${userToken}`,
      });
      assert.strictEqual(res.status, 403);
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

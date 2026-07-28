const { describe, it, after } = require('node:test');
const assert = require('node:assert');

const app = require('../src/app');
const server = app.listen(0);

after(() => server.close());

it('GET / responds with project info', async () => {
  const res = await fetch(`http://localhost:${server.address().port}/`);
  assert.strictEqual(res.status, 200);

  const data = await res.json();
  assert.strictEqual(data.project, 'Equipchain');
  assert.strictEqual(data.status, 'Monitoring Meters');
  assert.ok(data.contract);
});

it('GET /api/health returns healthy status', async () => {
  const res = await fetch(`http://localhost:${server.address().port}/api/health`);
  assert.strictEqual(res.status, 200);

  const data = await res.json();
  assert.strictEqual(data.status, 'healthy');
  assert.ok(typeof data.uptime === 'number');
  assert.ok(typeof data.timestamp === 'number');
});

it('POST /api/auth/challenge returns a token', async () => {
  const res = await fetch(
    `http://localhost:${server.address().port}/api/auth/challenge`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'GANONEXISTENT123' }),
    },
  );
  assert.strictEqual(res.status, 200);

  const data = await res.json();
  assert.ok(data.token);
  assert.strictEqual(data.expiresIn, 3600);
});

it('POST /api/auth/challenge works without wallet', async () => {
  const res = await fetch(
    `http://localhost:${server.address().port}/api/auth/challenge`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
  assert.strictEqual(res.status, 200);

  const data = await res.json();
  assert.ok(data.token);
});

it('GET /api/protected returns data with valid token', async () => {
  // First get a token
  const authRes = await fetch(
    `http://localhost:${server.address().port}/api/auth/challenge`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'GTESTWALLET123' }),
    },
  );
  const { token } = await authRes.json();

  // Use token to access protected route
  const res = await fetch(
    `http://localhost:${server.address().port}/api/protected`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  assert.strictEqual(res.status, 200);

  const data = await res.json();
  assert.strictEqual(data.data, 'Sensitive meter data');
  assert.ok(data.contract);
});

it('GET /api/protected returns 401 without Authorization header', async () => {
  const res = await fetch(
    `http://localhost:${server.address().port}/api/protected`,
  );
  assert.strictEqual(res.status, 401);

  const data = await res.json();
  assert.strictEqual(data.error, 'Unauthorized');
});

it('GET /api/protected returns 401 without Bearer prefix', async () => {
  const res = await fetch(
    `http://localhost:${server.address().port}/api/protected`,
    { headers: { Authorization: 'Token some-value' } },
  );
  assert.strictEqual(res.status, 401);
});

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-admin-api-tests';

const app = require('../index');
const { userStore, deviceStore, configStore } = require('../src/data/adminStore');

const server = app.listen(0);
after(() => server.close());

const signToken = (roles) =>
  jwt.sign({ sub: 'test-user', roles }, process.env.JWT_SECRET, { expiresIn: '1h' });

const adminToken = signToken(['admin']);
const userToken = signToken(['user']);

const baseUrl = () => `http://localhost:${server.address().port}`;

const request = async (method, path, { token, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
};

beforeEach(() => {
  userStore._reset();
  deviceStore._reset();
  configStore._reset();
});

describe('Admin API auth guards', () => {
  it('returns 401 without a token', async () => {
    const res = await request('GET', '/api/admin/users');
    assert.strictEqual(res.status, 401);
  });

  it('returns 403 with a non-admin token', async () => {
    const res = await request('GET', '/api/admin/users', { token: userToken });
    assert.strictEqual(res.status, 403);
  });

  it('returns 401 with a malformed token', async () => {
    const res = await request('GET', '/api/admin/users', { token: 'not-a-real-token' });
    assert.strictEqual(res.status, 401);
  });
});

describe('Admin API - users', () => {
  it('lists users (empty initially)', async () => {
    const res = await request('GET', '/api/admin/users', { token: adminToken });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.data.data, []);
    assert.strictEqual(res.data.pagination.total, 0);
  });

  it('creates a user', async () => {
    const res = await request('POST', '/api/admin/users', {
      token: adminToken,
      body: { email: 'a@example.com', name: 'Alice' },
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.email, 'a@example.com');
    assert.deepStrictEqual(res.data.roles, ['user']);
    assert.strictEqual(res.data.active, true);
  });

  it('rejects invalid user creation', async () => {
    const res = await request('POST', '/api/admin/users', {
      token: adminToken,
      body: { name: 'No Email' },
    });
    assert.strictEqual(res.status, 400);
  });

  it('gets, updates roles, and deactivates a user', async () => {
    const created = await request('POST', '/api/admin/users', {
      token: adminToken,
      body: { email: 'b@example.com', name: 'Bob' },
    });
    const id = created.data.id;

    const got = await request('GET', `/api/admin/users/${id}`, { token: adminToken });
    assert.strictEqual(got.status, 200);
    assert.strictEqual(got.data.email, 'b@example.com');

    const updated = await request('PATCH', `/api/admin/users/${id}`, {
      token: adminToken,
      body: { roles: ['admin'] },
    });
    assert.strictEqual(updated.status, 200);
    assert.deepStrictEqual(updated.data.roles, ['admin']);

    const deactivated = await request('DELETE', `/api/admin/users/${id}`, { token: adminToken });
    assert.strictEqual(deactivated.status, 200);
    assert.strictEqual(deactivated.data.active, false);
  });

  it('returns 404 for a missing user', async () => {
    const res = await request('GET', '/api/admin/users/does-not-exist', { token: adminToken });
    assert.strictEqual(res.status, 404);
  });
});

describe('Admin API - config', () => {
  it('gets default config', async () => {
    const res = await request('GET', '/api/admin/config', { token: adminToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.maintenanceMode, false);
  });

  it('updates config and records an audit entry', async () => {
    const res = await request('PATCH', '/api/admin/config', {
      token: adminToken,
      body: { values: { maintenanceMode: true } },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.maintenanceMode, true);
    assert.strictEqual(configStore.auditLog().length, 1);
    assert.strictEqual(configStore.auditLog()[0].admin, 'test-user');
  });

  it('rejects an empty config update', async () => {
    const res = await request('PATCH', '/api/admin/config', {
      token: adminToken,
      body: { values: {} },
    });
    assert.strictEqual(res.status, 400);
  });

  it('resets config to defaults', async () => {
    await request('PATCH', '/api/admin/config', {
      token: adminToken,
      body: { values: { maintenanceMode: true } },
    });
    const res = await request('POST', '/api/admin/config/reset', { token: adminToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.maintenanceMode, false);
  });
});

describe('Admin API - devices', () => {
  it('registers, lists, updates, and removes a device', async () => {
    const created = await request('POST', '/api/admin/devices', {
      token: adminToken,
      body: { deviceId: 'meter-1', name: 'Meter One' },
    });
    assert.strictEqual(created.status, 201);
    const id = created.data.id;

    const listed = await request('GET', '/api/admin/devices', { token: adminToken });
    assert.strictEqual(listed.status, 200);
    assert.strictEqual(listed.data.data.length, 1);

    const updated = await request('PATCH', `/api/admin/devices/${id}`, {
      token: adminToken,
      body: { location: 'Building A' },
    });
    assert.strictEqual(updated.status, 200);
    assert.strictEqual(updated.data.location, 'Building A');

    const removed = await request('DELETE', `/api/admin/devices/${id}`, { token: adminToken });
    assert.strictEqual(removed.status, 200);

    const listedAfter = await request('GET', '/api/admin/devices', { token: adminToken });
    assert.strictEqual(listedAfter.data.data.length, 0);
  });

  it('returns 404 removing a missing device', async () => {
    const res = await request('DELETE', '/api/admin/devices/nope', { token: adminToken });
    assert.strictEqual(res.status, 404);
  });
});

describe('Admin API - system', () => {
  it('reports health', async () => {
    const res = await request('GET', '/api/admin/system/health', { token: adminToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.status, 'ok');
  });

  it('reports stats', async () => {
    const res = await request('GET', '/api/admin/system/stats', { token: adminToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(typeof res.data.users, 'number');
    assert.strictEqual(typeof res.data.devices, 'number');
  });

  it('reports ws-connections as zero (no WS server implemented yet)', async () => {
    const res = await request('GET', '/api/admin/system/ws-connections', { token: adminToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.count, 0);
  });
});
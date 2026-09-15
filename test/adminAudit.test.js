'use strict';

// test/adminAudit.test.js
//
// Tests for the shared admin audit trail (#95/#97): every privileged admin
// mutation - user create/role-change/deactivate, device register/update/
// delete, config update/reset - lands in one ordered trail readable via
// GET /api/admin/audit. Role grants previously left no record at all.

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-audit-tests';

const app = require('../index');
const {
  userStore,
  deviceStore,
  configStore,
  adminAuditLog,
  _resetAdminAudit,
  ADMIN_AUDIT_ACTIONS,
} = require('../src/data/adminStore');

const server = app.listen(0);
after(() => server.close());

const signToken = (roles) =>
  jwt.sign(
    { sub: 'auditor', roles, jti: require('crypto').randomUUID() },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

const adminToken = signToken(['admin']);

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
  _resetAdminAudit();
});

describe('admin audit trail', () => {
  it('records user creation with actor and target', async () => {
    await request('POST', '/api/admin/users', {
      token: adminToken,
      body: { email: 'audited@example.com', name: 'Audited', roles: ['user'] },
    });

    const entries = adminAuditLog();
    const entry = entries.find((e) => e.action === ADMIN_AUDIT_ACTIONS.USER_CREATE);
    assert.ok(entry, 'user.create entry exists');
    assert.strictEqual(entry.admin, 'auditor');
    assert.strictEqual(entry.changes.email, 'audited@example.com');
    assert.ok(entry.target);
    assert.ok(entry.timestamp);
  });

  it('records role updates (the highest-value admin action)', async () => {
    const created = await request('POST', '/api/admin/users', {
      token: adminToken,
      body: { email: 'promote@example.com', name: 'Promotee' },
    });

    await request('PATCH', `/api/admin/users/${created.data.id}`, {
      token: adminToken,
      body: { roles: ['admin'] },
    });

    const entry = adminAuditLog().find((e) => e.action === ADMIN_AUDIT_ACTIONS.USER_ROLES_UPDATE);
    assert.ok(entry, 'user.roles.update entry exists');
    assert.deepStrictEqual(entry.changes.roles, ['admin']);
  });

  it('records device lifecycle: create, update, delete', async () => {
    const created = await request('POST', '/api/admin/devices', {
      token: adminToken,
      body: { deviceId: 'dev-audit-1', name: 'Audited Device' },
    });
    await request('PATCH', `/api/admin/devices/${created.data.id}`, {
      token: adminToken,
      body: { name: 'Renamed Device' },
    });
    await request('DELETE', `/api/admin/devices/${created.data.id}`, { token: adminToken });

    const actions = adminAuditLog().map((e) => e.action);
    assert.ok(actions.includes(ADMIN_AUDIT_ACTIONS.DEVICE_CREATE));
    assert.ok(actions.includes(ADMIN_AUDIT_ACTIONS.DEVICE_UPDATE));
    assert.ok(actions.includes(ADMIN_AUDIT_ACTIONS.DEVICE_DELETE));
  });

  it('records config updates and mirrors them into the shared trail', async () => {
    await request('PATCH', '/api/admin/config', {
      token: adminToken,
      body: { values: { rateLimitPerMinute: 42 } },
    });

    const entry = adminAuditLog().find((e) => e.action === ADMIN_AUDIT_ACTIONS.CONFIG_UPDATE);
    assert.ok(entry, 'config.update entry exists in shared trail');
    assert.strictEqual(entry.changes.rateLimitPerMinute, 42);
  });

  it('GET /api/admin/audit returns entries most recent first', async () => {
    await request('POST', '/api/admin/users', {
      token: adminToken,
      body: { email: 'first@example.com', name: 'First' },
    });
    await request('POST', '/api/admin/users', {
      token: adminToken,
      body: { email: 'second@example.com', name: 'Second' },
    });

    const res = await request('GET', '/api/admin/audit?limit=10', { token: adminToken });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.data.length >= 2);
    const [newest, oldest] = res.data.data;
    assert.ok(newest.timestamp >= oldest.timestamp, 'most recent first');
  });

  it('supports action and admin filters', async () => {
    await request('POST', '/api/admin/users', {
      token: adminToken,
      body: { email: 'filter@example.com', name: 'F' },
    });
    await request('PATCH', '/api/admin/config', {
      token: adminToken,
      body: { values: { maintenanceMode: false } },
    });

    const res = await request('GET', `/api/admin/audit?action=${ADMIN_AUDIT_ACTIONS.USER_CREATE}`, {
      token: adminToken,
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.data.length >= 1);
    res.data.data.forEach((e) => {
      assert.strictEqual(e.action, ADMIN_AUDIT_ACTIONS.USER_CREATE);
      assert.strictEqual(e.admin, 'auditor');
    });
  });

  it('deactivating a user is audited', async () => {
    const created = await request('POST', '/api/admin/users', {
      token: adminToken,
      body: { email: 'bye@example.com', name: 'Bye' },
    });
    await request('DELETE', `/api/admin/users/${created.data.id}`, { token: adminToken });

    const entry = adminAuditLog().find((e) => e.action === ADMIN_AUDIT_ACTIONS.USER_DEACTIVATE);
    assert.ok(entry, 'user.deactivate entry exists');
    assert.strictEqual(entry.target, created.data.id);
  });
});

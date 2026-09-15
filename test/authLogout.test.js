'use strict';

// test/authLogout.test.js
//
// Tests for the user-facing POST /api/auth/logout. Admins already had
// server-side sign-out; regular users' "logout" only discarded the token
// client-side, so a copied token kept authenticating until natural expiry.
// This pins the real revocation contract for every authenticated caller.

const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-logout-tests';

const app = require('../index');

const server = app.listen(0);
after(() => server.close());

const SECRET = process.env.JWT_SECRET;
const baseUrl = () => `http://localhost:${server.address().port}`;

const signToken = (claims) =>
  jwt.sign({ jti: require('crypto').randomUUID(), ...claims }, SECRET, { expiresIn: '1h' });

async function post(path, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl()}${path}`, { method: 'POST', headers });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function get(path, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl()}${path}`, { headers });
  return { status: res.status };
}

describe('POST /api/auth/logout', () => {
  it('requires a bearer token (401 without)', async () => {
    const res = await post('/api/auth/logout');
    assert.strictEqual(res.status, 401);
  });

  it('rejects an invalid token (401)', async () => {
    const res = await post('/api/auth/logout', 'not-a-token');
    assert.strictEqual(res.status, 401);
  });

  it('revokes a regular user token so it no longer authenticates', async () => {
    const token = signToken({ sub: 'user-1', roles: ['user'] });

    // Sanity: token works before logout.
    const before = await get('/api/protected', token);
    assert.strictEqual(before.status, 200);

    const res = await post('/api/auth/logout', token);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);

    // The whole point: the token is dead AFTER logout, not just client-side.
    const afterLogout = await get('/api/protected', token);
    assert.strictEqual(afterLogout.status, 401);

    // And logout itself no longer accepts it.
    const logoutAgain = await post('/api/auth/logout', token);
    assert.strictEqual(logoutAgain.status, 401);
  });

  it('works for admin tokens too (same contract as /api/admin/logout)', async () => {
    const token = signToken({ sub: 'admin-1', roles: ['admin'] });

    const res = await post('/api/auth/logout', token);
    assert.strictEqual(res.status, 200);

    const afterLogout = await get('/api/protected', token);
    assert.strictEqual(afterLogout.status, 401);
  });

  it('reports success:false for authenticated tokens without a jti (nothing revocable)', async () => {
    // Legacy-shaped token: no jti claim. Authentication still succeeds; the
    // endpoint answers honestly that nothing was revoked.
    const token = jwt.sign({ sub: 'legacy-user', roles: ['user'] }, SECRET, { expiresIn: '1h' });
    const res = await post('/api/auth/logout', token);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, false);
    assert.match(res.data.message, /jti/);
  });
});

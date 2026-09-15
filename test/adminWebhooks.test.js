'use strict';

// test/adminWebhooks.test.js
//
// Tests for the webhook admin CRUD surface. The delivery pipeline existed
// since the webhook hardening batch, but no route could register a target,
// so the pipeline was unreachable from the API. These tests pin the CRUD
// contract: registration, duplicate conflict, secret redaction in list and
// read responses, delivery-log reads, update, and delete.

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-webhook-admin-tests';

const app = require('../index');
const { webhookRepository } = require('../src/repositories/WebhookRepository');

const server = app.listen(0);
after(async () => {
  server.close();
  await webhookRepository.clear();
});

const signToken = (roles) =>
  jwt.sign(
    { sub: 'test-user', roles, jti: require('crypto').randomUUID() },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

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

beforeEach(async () => {
  await webhookRepository.clear();
});

describe('Admin API - webhooks auth guards', () => {
  it('returns 401 without a token', async () => {
    const res = await request('GET', '/api/admin/webhooks');
    assert.strictEqual(res.status, 401);
  });

  it('returns 403 with a non-admin token', async () => {
    const res = await request('GET', '/api/admin/webhooks', { token: userToken });
    assert.strictEqual(res.status, 403);
  });
});

describe('Admin API - webhooks CRUD', () => {
  it('registers a webhook and returns it with the secret (creation-time only)', async () => {
    const res = await request('POST', '/api/admin/webhooks', {
      token: adminToken,
      body: {
        url: 'https://ops.example.com/hooks/meters',
        event: 'meter.reading',
        secret: 'super-secret-signing-material-01',
      },
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.url, 'https://ops.example.com/hooks/meters');
    assert.strictEqual(res.data.event, 'meter.reading');
    assert.strictEqual(res.data.status, 'active');
    assert.strictEqual(res.data.secret, 'super-secret-signing-material-01');
  });

  it('rejects non-http(s) URLs with 400', async () => {
    const res = await request('POST', '/api/admin/webhooks', {
      token: adminToken,
      body: { url: 'ftp://ops.example.com/hooks', event: 'meter.reading' },
    });
    assert.strictEqual(res.status, 400);
  });

  it('rejects a webhook registration missing the event with 400', async () => {
    const res = await request('POST', '/api/admin/webhooks', {
      token: adminToken,
      body: { url: 'https://ops.example.com/hooks/x' },
    });
    assert.strictEqual(res.status, 400);
  });

  it('rejects a duplicate (url, event) pair with 409', async () => {
    const body = { url: 'https://ops.example.com/hooks/dup', event: 'meter.reading' };
    const first = await request('POST', '/api/admin/webhooks', { token: adminToken, body });
    assert.strictEqual(first.status, 201);

    const second = await request('POST', '/api/admin/webhooks', { token: adminToken, body });
    assert.strictEqual(second.status, 409);
  });

  it('lists webhooks without leaking secrets', async () => {
    await request('POST', '/api/admin/webhooks', {
      token: adminToken,
      body: {
        url: 'https://ops.example.com/hooks/a',
        event: 'meter.reading',
        secret: 'secret-material-aaaa-0123456789',
      },
    });

    const res = await request('GET', '/api/admin/webhooks', { token: adminToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.data.length, 1);
    assert.strictEqual('secret' in res.data.data[0], false);
    assert.strictEqual(res.data.data[0].url, 'https://ops.example.com/hooks/a');
  });

  it('gets a single webhook without the secret', async () => {
    const created = await request('POST', '/api/admin/webhooks', {
      token: adminToken,
      body: { url: 'https://ops.example.com/hooks/b', event: 'meter.reading' },
    });

    const res = await request('GET', `/api/admin/webhooks/${created.data.id}`, { token: adminToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual('secret' in res.data, false);
  });

  it('returns 404 for an unknown webhook id', async () => {
    const res = await request('GET', '/api/admin/webhooks/999999', { token: adminToken });
    assert.strictEqual(res.status, 404);
  });

  it('returns delivery logs (empty at first) for a registered webhook', async () => {
    const created = await request('POST', '/api/admin/webhooks', {
      token: adminToken,
      body: { url: 'https://ops.example.com/hooks/c', event: 'meter.reading' },
    });

    const res = await request('GET', `/api/admin/webhooks/${created.data.id}/deliveries`, { token: adminToken });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.data.data, []);
    assert.strictEqual(res.data.count, 0);
  });

  it('updates webhook status to inactive and pauses it', async () => {
    const created = await request('POST', '/api/admin/webhooks', {
      token: adminToken,
      body: { url: 'https://ops.example.com/hooks/d', event: 'meter.reading' },
    });

    const res = await request('PATCH', `/api/admin/webhooks/${created.data.id}`, {
      token: adminToken,
      body: { status: 'inactive' },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.status, 'inactive');
  });

  it('deletes a webhook', async () => {
    const created = await request('POST', '/api/admin/webhooks', {
      token: adminToken,
      body: { url: 'https://ops.example.com/hooks/e', event: 'meter.reading' },
    });

    const del = await request('DELETE', `/api/admin/webhooks/${created.data.id}`, { token: adminToken });
    assert.strictEqual(del.status, 200);
    assert.strictEqual(del.data.success, true);

    const gone = await request('GET', `/api/admin/webhooks/${created.data.id}`, { token: adminToken });
    assert.strictEqual(gone.status, 404);
  });

  it('allows re-registering the same URL after the webhook is deleted', async () => {
    const body = { url: 'https://ops.example.com/hooks/recreate', event: 'meter.reading' };
    const first = await request('POST', '/api/admin/webhooks', { token: adminToken, body });
    assert.strictEqual(first.status, 201);

    await request('DELETE', `/api/admin/webhooks/${first.data.id}`, { token: adminToken });

    const again = await request('POST', '/api/admin/webhooks', { token: adminToken, body });
    assert.strictEqual(again.status, 201);
  });
});

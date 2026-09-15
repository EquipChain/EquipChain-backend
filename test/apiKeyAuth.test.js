'use strict';

// test/apiKeyAuth.test.js
//
// Tests for the API-key authentication middleware. The middleware previously
// had no counterpart at all: the repository issued keys and the rate limiter
// understood req.apiKey.tier, but nothing authenticated the x-api-key header.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const { requireApiKey, hashKey } = require('../src/middleware/apiKeyAuth');
const { apiKeyRepository } = require('../src/repositories/ApiKeyRepository');
const { _resetStore } = require('../src/middleware/rateLimiter');

describe('apiKeyAuth middleware', () => {
  let app;
  let server;
  let baseUrl;

  const VALID_KEY = 'ek_test_valid_key_0123456789abcdef';
  const READ_ONLY_KEY = 'ek_test_readonly_0123456789abcdef';
  const EXPIRED_KEY = 'ek_test_expired_0123456789abcdef';
  const REVOKED_KEY = 'ek_test_revoked_0123456789abcdef';

  before(async () => {
    await apiKeyRepository.clear();
    // clear() resets _nextId and wipes the seeded dev key; recreate one so
    // other tests relying on the dev key are unaffected by ordering.
    await apiKeyRepository.create({ key: 'ek_dev_equipchain_default_key', name: 'Development Key' });

    await apiKeyRepository.create({
      key: VALID_KEY,
      name: 'Full Access',
      permissions: ['read', 'write'],
      tier: 'standard',
    });
    await apiKeyRepository.create({
      key: READ_ONLY_KEY,
      name: 'Read Only',
      permissions: ['read'],
      tier: 'standard',
    });
    await apiKeyRepository.create({
      key: EXPIRED_KEY,
      name: 'Expired',
      permissions: ['read'],
      status: 'active',
      expiresAt: new Date(Date.now() - 60_000).toISOString(), // already past
    });
    const revoked = await apiKeyRepository.create({
      key: REVOKED_KEY,
      name: 'Revoked',
      permissions: ['read'],
    });
    await apiKeyRepository.revokeKey(REVOKED_KEY);
    assert.ok(revoked);

    app = express();
    app.use('/api/analytics/readings', requireApiKey({ permission: 'read' }), (req, res) => {
      res.json({ ok: true, tier: req.apiKey.tier, keyId: req.apiKey.id });
    });
    app.use('/api/admin/keys-only', requireApiKey(), (req, res) => {
      res.json({ ok: true });
    });
    server = app.listen(0);
    baseUrl = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    server.close();
    await apiKeyRepository.clear();
    _resetStore();
  });

  it('rejects requests without an x-api-key header (401)', async () => {
    const res = await fetch(`${baseUrl}/api/analytics/readings`);
    assert.strictEqual(res.status, 401);
  });

  it('rejects unknown keys with 401', async () => {
    const res = await fetch(`${baseUrl}/api/analytics/readings`, {
      headers: { 'x-api-key': 'ek_totally_unknown_key' },
    });
    assert.strictEqual(res.status, 401);
  });

  it('rejects expired keys with 401', async () => {
    const res = await fetch(`${baseUrl}/api/analytics/readings`, {
      headers: { 'x-api-key': EXPIRED_KEY },
    });
    assert.strictEqual(res.status, 401);
  });

  it('rejects revoked keys with 401', async () => {
    const res = await fetch(`${baseUrl}/api/analytics/readings`, {
      headers: { 'x-api-key': REVOKED_KEY },
    });
    assert.strictEqual(res.status, 401);
  });

  it('accepts a valid key and attaches tier + key id', async () => {
    const res = await fetch(`${baseUrl}/api/analytics/readings`, {
      headers: { 'x-api-key': VALID_KEY },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.tier, 'standard');
    assert.ok(body.keyId);
  });

  it('enforces the required permission with 403 when missing', async () => {
    // Route requires 'write'; the read-only key only holds 'read'.
    const writeApp = express();
    writeApp.use(requireApiKey({ permission: 'write' }), (req, res) => res.json({ ok: true }));
    const writeServer = writeApp.listen(0);
    try {
      const res = await fetch(`http://localhost:${writeServer.address().port}/`, {
        headers: { 'x-api-key': READ_ONLY_KEY },
      });
      assert.strictEqual(res.status, 403);
    } finally {
      writeServer.close();
    }
  });

  it('rejects non-string header values safely', async () => {
    const res = await fetch(`${baseUrl}/api/analytics/readings`, {
      headers: { 'x-api-key': '' },
    });
    assert.strictEqual(res.status, 401);
  });

  it('hashKey produces deterministic 32-byte digests (timing-safe input shape)', () => {
    const a = hashKey('same');
    const b = hashKey('same');
    const c = hashKey('different');
    assert.strictEqual(a.length, 32);
    assert.deepStrictEqual([...a], [...b]);
    assert.notDeepStrictEqual([...a], [...c]);
  });
});

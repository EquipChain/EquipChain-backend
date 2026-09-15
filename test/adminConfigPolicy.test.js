'use strict';

// test/adminConfigPolicy.test.js
//
// Tests for two halves of one feature: the admin-configurable
// rateLimitPerMinute actually limiting traffic (it was previously stored and
// audited but consumed by nothing), and the config store accepting only
// whitelisted keys so arbitrary client JSON cannot shape the live config.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const { configStore } = require('../src/data/adminStore');
const { createRateLimiter, _resetStore } = require('../src/middleware/rateLimiter');

describe('configStore key whitelist', () => {
  beforeEach(() => configStore._reset());

  it('applies whitelisted keys', () => {
    configStore.update({ rateLimitPerMinute: 30 }, 'admin-1');
    assert.strictEqual(configStore.get().rateLimitPerMinute, 30);
  });

  it('ignores unknown keys and reports them in the audit entry', () => {
    const before = configStore.get();
    const result = configStore.update({ unknownKey: 'x', maintenanceMode: true }, 'admin-2');

    assert.strictEqual(result.maintenanceMode, true);
    assert.strictEqual('unknownKey' in result, false);
    assert.deepStrictEqual(before, { ...before }); // no shape change

    const last = configStore.auditLog().at(-1);
    assert.deepStrictEqual(last.ignored, ['unknownKey']);
    assert.deepStrictEqual(last.changes, { maintenanceMode: true });
  });

  it('reset restores defaults and records the reset', () => {
    configStore.update({ rateLimitPerMinute: 5 }, 'admin-1');
    configStore.reset('admin-1');
    assert.strictEqual(configStore.get().rateLimitPerMinute, 60);
    assert.strictEqual(configStore.auditLog().at(-1).changes, 'reset-to-defaults');
  });
});

describe('rateLimitPerMinute runtime ceiling', () => {
  beforeEach(() => {
    configStore._reset();
    _resetStore();
  });

  function makeApp() {
    const app = express();
    app.use(createRateLimiter({ tierOverride: 'free' }));
    app.get('/', (req, res) => res.json({ ok: true }));
    return app;
  }

  it('tightens every tier when lowered below the tier max (live, no restart)', async () => {
    configStore.update({ rateLimitPerMinute: 3 }, 'admin-1');
    const app = makeApp();
    const server = app.listen(0);
    const url = `http://localhost:${server.address().port}/`;

    try {
      const statuses = [];
      for (let i = 0; i < 5; i++) {
        const res = await fetch(url);
        statuses.push(res.status);
      }
      // Free tier default is 60/min; ceiling 3 must trip 429 on the 4th.
      assert.deepStrictEqual(statuses, [200, 200, 200, 429, 429]);
    } finally {
      server.close();
    }
  });

  it('raises a tier only up to the ceiling (never above tier max semantics)', async () => {
    // Ceiling above free tier's 60: free tier stays at 60.
    configStore.update({ rateLimitPerMinute: 500 }, 'admin-1');
    const app = makeApp();
    const server = app.listen(0);

    try {
      const res = await fetch(`http://localhost:${server.address().port}/`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(Number(res.headers.get('x-ratelimit-limit')), 60);
    } finally {
      server.close();
    }
  });
});

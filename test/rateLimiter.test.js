'use strict';

/**
 * test/rateLimiter.test.js
 *
 * Tests for the tiered rate limiting system (Issue #29).
 *
 * Covers:
 *  - Tier detection (free fallback, JWT role, API key tier)
 *  - Limit enforcement — 429 on exceeding limit
 *  - Response headers (X-RateLimit-*, Retry-After)
 *  - GET /api/system/rate-limits status endpoint
 */

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const { determineTier, createRateLimiter, _resetStore } = require('../src/middleware/rateLimiter');
const { RATE_LIMIT_TIERS, PREMIUM_API_KEY_TIERS } = require('../src/config/rateLimits');

// ─── Integration helpers ──────────────────────────────────────────────────────

const app = require('../index');

let server;
let baseUrl;

before(() => {
  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://localhost:${port}`;
});

after(() => server.close());

// Reset the in-memory rate limit store before every test so counts don't bleed
// between tests.
beforeEach(() => _resetStore());

// ─── Unit: RATE_LIMIT_TIERS config ───────────────────────────────────────────

describe('RATE_LIMIT_TIERS config', () => {
  it('defines free tier with 60 req/min', () => {
    assert.equal(RATE_LIMIT_TIERS.free.max, 60);
    assert.equal(RATE_LIMIT_TIERS.free.windowMs, 60_000);
  });

  it('defines premium tier with 600 req/min', () => {
    assert.equal(RATE_LIMIT_TIERS.premium.max, 600);
    assert.equal(RATE_LIMIT_TIERS.premium.windowMs, 60_000);
  });

  it('defines admin tier with 6000 req/min', () => {
    assert.equal(RATE_LIMIT_TIERS.admin.max, 6_000);
    assert.equal(RATE_LIMIT_TIERS.admin.windowMs, 60_000);
  });

  it('defines internal tier with 60000 req/min', () => {
    assert.equal(RATE_LIMIT_TIERS.internal.max, 60_000);
    assert.equal(RATE_LIMIT_TIERS.internal.windowMs, 60_000);
  });

  it('PREMIUM_API_KEY_TIERS contains standard and premium', () => {
    assert.ok(PREMIUM_API_KEY_TIERS.has('standard'));
    assert.ok(PREMIUM_API_KEY_TIERS.has('premium'));
  });
});

// ─── Unit: determineTier ─────────────────────────────────────────────────────

describe('determineTier', () => {
  it('returns free for unauthenticated request', () => {
    const req = {};
    assert.equal(determineTier(req), 'free');
  });

  it('returns free when req.user has no role', () => {
    const req = { user: { sub: 'u1' } };
    assert.equal(determineTier(req), 'free');
  });

  it('returns free for user with free role', () => {
    const req = { user: { role: 'free' } };
    assert.equal(determineTier(req), 'free');
  });

  it('returns premium for user with premium role', () => {
    const req = { user: { role: 'premium' } };
    assert.equal(determineTier(req), 'premium');
  });

  it('returns admin for user with admin role', () => {
    const req = { user: { role: 'admin' } };
    assert.equal(determineTier(req), 'admin');
  });

  it('returns internal for user with internal role', () => {
    const req = { user: { role: 'internal' } };
    assert.equal(determineTier(req), 'internal');
  });

  it('returns internal for API key with internal tier', () => {
    const req = { apiKey: { tier: 'internal' } };
    assert.equal(determineTier(req), 'internal');
  });

  it('returns premium for API key with standard tier', () => {
    const req = { apiKey: { tier: 'standard' } };
    assert.equal(determineTier(req), 'premium');
  });

  it('returns premium for API key with premium tier', () => {
    const req = { apiKey: { tier: 'premium' } };
    assert.equal(determineTier(req), 'premium');
  });

  it('API key internal tier takes precedence over admin JWT role', () => {
    const req = { apiKey: { tier: 'internal' }, user: { role: 'admin' } };
    assert.equal(determineTier(req), 'internal');
  });

  it('falls back to free for unrecognised API key tier', () => {
    const req = { apiKey: { tier: 'unknown' } };
    assert.equal(determineTier(req), 'free');
  });

  it('supports roles array (legacy shape) — admin in first position', () => {
    const req = { user: { roles: ['admin'] } };
    assert.equal(determineTier(req), 'admin');
  });
});

// ─── Unit: createRateLimiter (middleware) ────────────────────────────────────

describe('createRateLimiter middleware', () => {
  /**
   * Helper to fabricate a minimal Express-like req/res/next triple.
   */
  function mockContext({ userRole, apiKeyTier, ip = '127.0.0.1' } = {}) {
    const req = {
      ip,
      originalUrl: '/test',
      method: 'GET',
      ...(userRole ? { user: { sub: `user-${userRole}`, role: userRole } } : {}),
      ...(apiKeyTier ? { apiKey: { key: `key-${apiKeyTier}`, tier: apiKeyTier } } : {}),
    };

    const headers = {};
    let statusCode = 200;
    let body = null;

    const res = {
      get headers() {
        return headers;
      },
      setHeader(name, value) {
        headers[name.toLowerCase()] = String(value);
      },
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        body = data;
        return this;
      },
      get statusCode() {
        return statusCode;
      },
      get body() {
        return body;
      },
    };

    return { req, res };
  }

  it('sets X-RateLimit-Limit header', () => {
    const middleware = createRateLimiter({ tierOverride: 'free' });
    const { req, res } = mockContext();
    let called = false;
    middleware(req, res, () => { called = true; });
    assert.ok(called, 'next() should be called');
    assert.equal(res.headers['x-ratelimit-limit'], '60');
  });

  it('sets X-RateLimit-Remaining header', () => {
    const middleware = createRateLimiter({ tierOverride: 'free' });
    const { req, res } = mockContext();
    middleware(req, res, () => {});
    const remaining = parseInt(res.headers['x-ratelimit-remaining'], 10);
    assert.equal(remaining, 59); // 60 max, 1 used
  });

  it('sets X-RateLimit-Reset header as future Unix timestamp', () => {
    const before = Math.floor(Date.now() / 1000);
    const middleware = createRateLimiter({ tierOverride: 'free' });
    const { req, res } = mockContext();
    middleware(req, res, () => {});
    const reset = parseInt(res.headers['x-ratelimit-reset'], 10);
    assert.ok(reset >= before + 59, `reset (${reset}) should be ~60s from now`);
  });

  it('allows requests under the limit', () => {
    const middleware = createRateLimiter({ tierOverride: 'free' });
    for (let i = 0; i < 60; i++) {
      const { req, res } = mockContext({ ip: '1.2.3.4' });
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });
      assert.ok(nextCalled, `request ${i + 1} should pass`);
      assert.equal(res.statusCode, 200);
    }
  });

  it('blocks the request that exceeds the limit with 429', () => {
    const middleware = createRateLimiter({ tierOverride: 'free' });
    // Exhaust the free-tier limit (60)
    for (let i = 0; i < 60; i++) {
      const { req, res } = mockContext({ ip: '2.2.2.2' });
      middleware(req, res, () => {});
    }
    // 61st request should be blocked
    const { req, res } = mockContext({ ip: '2.2.2.2' });
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    assert.ok(!nextCalled, 'next() should NOT be called when limit exceeded');
    assert.equal(res.statusCode, 429);
  });

  it('returns Retry-After header on 429', () => {
    const middleware = createRateLimiter({ tierOverride: 'free' });
    for (let i = 0; i <= 60; i++) {
      const { req, res } = mockContext({ ip: '3.3.3.3' });
      middleware(req, res, () => {});
    }
    const { req, res } = mockContext({ ip: '3.3.3.3' });
    middleware(req, res, () => {});
    const retryAfter = parseInt(res.headers['retry-after'], 10);
    assert.ok(retryAfter > 0, 'Retry-After should be a positive number');
  });

  it('returns JSON error body on 429', () => {
    const middleware = createRateLimiter({ tierOverride: 'free' });
    for (let i = 0; i <= 60; i++) {
      const { req, res } = mockContext({ ip: '4.4.4.4' });
      middleware(req, res, () => {});
    }
    const { req, res } = mockContext({ ip: '4.4.4.4' });
    middleware(req, res, () => {});
    assert.equal(res.body?.error, 'Too Many Requests');
    assert.ok(typeof res.body?.retryAfter === 'number');
  });

  it('counts per identity — different IPs have independent counters', () => {
    const middleware = createRateLimiter({ tierOverride: 'free' });
    // Exhaust limit for IP A
    for (let i = 0; i <= 60; i++) {
      const { req, res } = mockContext({ ip: '10.0.0.1' });
      middleware(req, res, () => {});
    }
    // IP B should still be allowed
    const { req, res } = mockContext({ ip: '10.0.0.2' });
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled, 'IP B should not be rate-limited');
  });

  it('attaches req.rateLimit metadata for downstream handlers', () => {
    const middleware = createRateLimiter({ tierOverride: 'premium' });
    const { req, res } = mockContext({ userRole: 'premium' });
    middleware(req, res, () => {});
    assert.ok(req.rateLimit, 'req.rateLimit should be set');
    assert.equal(req.rateLimit.tier, 'premium');
    assert.equal(req.rateLimit.limit, 600);
    assert.ok(typeof req.rateLimit.remaining === 'number');
    assert.ok(typeof req.rateLimit.resetAt === 'number');
  });

  it('uses higher limit for premium tier', () => {
    const middleware = createRateLimiter({ tierOverride: 'premium' });
    const { req, res } = mockContext({ ip: '5.5.5.5' });
    middleware(req, res, () => {});
    assert.equal(res.headers['x-ratelimit-limit'], '600');
  });

  it('uses higher limit for admin tier', () => {
    const middleware = createRateLimiter({ tierOverride: 'admin' });
    const { req, res } = mockContext({ ip: '6.6.6.6' });
    middleware(req, res, () => {});
    assert.equal(res.headers['x-ratelimit-limit'], '6000');
  });

  it('uses highest limit for internal tier', () => {
    const middleware = createRateLimiter({ tierOverride: 'internal' });
    const { req, res } = mockContext({ ip: '7.7.7.7' });
    middleware(req, res, () => {});
    assert.equal(res.headers['x-ratelimit-limit'], '60000');
  });
});

// ─── Integration: GET /api/system/rate-limits ─────────────────────────────────

describe('GET /api/system/rate-limits', () => {
  it('returns 200 with tier info for unauthenticated request', async () => {
    const res = await fetch(`${baseUrl}/api/system/rate-limits`);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.tier, 'free');
    assert.equal(data.limit, RATE_LIMIT_TIERS.free.max);
    assert.ok(typeof data.remaining === 'number');
    assert.ok(typeof data.resetTime === 'string');
    // resetTime should be a valid ISO date
    assert.ok(!Number.isNaN(new Date(data.resetTime).getTime()));
  });

  it('includes rate-limit headers in the response', async () => {
    const res = await fetch(`${baseUrl}/api/system/rate-limits`);
    assert.ok(res.headers.get('x-ratelimit-limit'), 'should include X-RateLimit-Limit');
    assert.ok(res.headers.get('x-ratelimit-remaining'), 'should include X-RateLimit-Remaining');
    assert.ok(res.headers.get('x-ratelimit-reset'), 'should include X-RateLimit-Reset');
  });

  it('remaining decreases with each request', async () => {
    const first = await fetch(`${baseUrl}/api/system/rate-limits`);
    const second = await fetch(`${baseUrl}/api/system/rate-limits`);

    const d1 = await first.json();
    const d2 = await second.json();

    // Both requests come from the same IP so the second should have less remaining
    assert.ok(d2.remaining < d1.remaining, 'remaining should decrease');
  });

  it('does not return retryAfter when limit is not exceeded', async () => {
    const res = await fetch(`${baseUrl}/api/system/rate-limits`);
    const data = await res.json();
    assert.equal(data.retryAfter, undefined, 'retryAfter should be absent when not rate-limited');
  });
});

// ─── Integration: 429 enforcement end-to-end ─────────────────────────────────

describe('rate limit enforcement — end to end', () => {
  it('returns 429 with Retry-After after exceeding free limit', async () => {
    // Use a dedicated in-process rate limiter with a tiny limit so we do not
    // need to fire 60 real HTTP requests.  We exercise the real middleware
    // logic by driving it directly.
    const { createRateLimiter: make, _resetStore: reset } = require('../src/middleware/rateLimiter');
    reset();

    const mw = make({ tierOverride: 'free' });
    const ip = 'test-e2e-ip';

    let lastRes;
    for (let i = 0; i <= RATE_LIMIT_TIERS.free.max; i++) {
      const { req, res } = (() => {
        const r = { ip, originalUrl: '/x', method: 'GET' };
        const headers = {};
        let code = 200;
        let body = null;
        const rs = {
          setHeader(k, v) { headers[k.toLowerCase()] = String(v); },
          status(c) { code = c; return this; },
          json(d) { body = d; return this; },
          get statusCode() { return code; },
          get body() { return body; },
          get headers() { return headers; },
        };
        return { req: r, res: rs };
      })();
      mw(req, res, () => {});
      lastRes = res;
    }

    assert.equal(lastRes.statusCode, 429);
    const retryAfter = parseInt(lastRes.headers['retry-after'], 10);
    assert.ok(retryAfter > 0);
    assert.equal(lastRes.body.error, 'Too Many Requests');
  });
});

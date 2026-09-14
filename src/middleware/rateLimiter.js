/**
 * src/middleware/rateLimiter.js
 *
 * Tiered rate limiting middleware (Issue #29).
 *
 * Tier resolution order:
 *  1. req.apiKey.tier  — API-key auth sets this (internal / standard / premium)
 *  2. req.user.role    — JWT auth sets this (admin / premium / free)
 *  3. fallback         — 'free' for unauthenticated requests
 *
 * Store: in-memory Map (suitable for single-instance / test environments).
 * Replace with a Redis-backed adapter when Issue #12 lands.
 *
 * Each counter entry:
 *  { count: number, resetAt: number (epoch ms) }
 *
 * Response headers (standard draft):
 *  X-RateLimit-Limit     — tier max
 *  X-RateLimit-Remaining — requests left in current window
 *  X-RateLimit-Reset     — Unix timestamp (seconds) when window resets
 *  Retry-After           — seconds until reset (only on 429)
 */

'use strict';

const { childLogger } = require('../config/logger');
const { RATE_LIMIT_TIERS, PREMIUM_API_KEY_TIERS } = require('../config/rateLimits');

const log = childLogger('rate-limiter');

// ─── In-memory store ─────────────────────────────────────────────────────────

/**
 * Map<counterKey, { count: number, resetAt: number }>
 * Exported for testing / inspection only.
 */
const _store = new Map();

/**
 * Upper bound on tracked counter entries. Without it, an attacker who
 * randomizes per-request identity fields (spoofed x-forwarded-for behind a
 * trusting proxy, or high-cardinality API keys) mints a fresh Map entry per
 * request and grows the store without limit - a memory-exhaustion DoS on a
 * single-instance deployment. When the cap is hit, expired entries are
 * dropped first, then the soonest-to-expire; worst case under attack, some
 * clients briefly share a window, which is strictly better than OOM.
 */
const MAX_TRACKED_KEYS = parseInt(process.env.RATE_LIMIT_MAX_KEYS || '100000', 10);

/** Wipe all counters. Useful in tests. */
function _resetStore() {
  _store.clear();
}

/**
 * Evict entries when the store grows past MAX_TRACKED_KEYS.
 * Amortized: only runs when a NEW key is created and the threshold is
 * crossed, not on every request.
 */
function _enforceStoreCap() {
  if (_store.size <= MAX_TRACKED_KEYS) {
    return;
  }

  const now = Date.now();
  // Drop expired entries first - they are pure garbage.
  for (const [key, entry] of _store) {
    if (now >= entry.resetAt) {
      _store.delete(key);
    }
  }

  // Still over? Evict soonest-to-expire entries (they free up first anyway).
  if (_store.size > MAX_TRACKED_KEYS) {
    const byExpiry = [..._store.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    const toEvict = _store.size - MAX_TRACKED_KEYS;
    for (let i = 0; i < toEvict; i++) {
      _store.delete(byExpiry[i][0]);
    }
    log.warn(
      { evicted: toEvict, storeSize: _store.size, cap: MAX_TRACKED_KEYS },
      'rate limit store cap reached; evicted soonest-to-expire counters'
    );
  }
}

// ─── Tier detection ───────────────────────────────────────────────────────────

/**
 * Determine the rate-limit tier for an incoming request.
 *
 * @param {import('express').Request} req
 * @returns {'free'|'premium'|'admin'|'internal'}
 */
function determineTier(req) {
  // 1. API-key auth takes precedence (set by API-key middleware from Issue #20)
  const apiKeyTier = req.apiKey?.tier;
  if (apiKeyTier) {
    if (apiKeyTier === 'internal') return 'internal';
    if (PREMIUM_API_KEY_TIERS.has(apiKeyTier)) return 'premium';
  }

  // 2. JWT user role (set by authenticate middleware from Issue #5)
  const role = req.user?.role ?? req.user?.roles?.[0];
  if (role === 'admin') return 'admin';
  if (role === 'internal') return 'internal';
  if (role === 'premium') return 'premium';

  // 3. Default: free tier
  return 'free';
}

// ─── Counter key ──────────────────────────────────────────────────────────────

/**
 * Build a stable counter key that is scoped to one (identity, tier) pair.
 * This prevents a single IP from burning another user's quota.
 *
 * @param {import('express').Request} req
 * @param {string} tier
 * @returns {string}
 */
function _buildKey(req, tier) {
  const identity =
    req.user?.sub ??
    req.user?.id ??
    req.apiKey?.key ??
    req.ip ??
    'anonymous';
  return `${tier}:${identity}`;
}

// ─── Core middleware factory ──────────────────────────────────────────────────

/**
 * Returns an Express middleware that enforces tiered rate limits.
 *
 * @param {object} [opts]
 * @param {string} [opts.tierOverride]  Force a specific tier regardless of req state.
 * @returns {import('express').RequestHandler}
 */
function createRateLimiter(opts = {}) {
  return function rateLimiterMiddleware(req, res, next) {
    const tier = opts.tierOverride ?? determineTier(req);
    const tierConfig = RATE_LIMIT_TIERS[tier];

    if (!tierConfig) {
      // Unknown tier — fail open to avoid blocking legitimate traffic
      return next();
    }

    const { windowMs, max, message } = tierConfig;
    const now = Date.now();
    const key = _buildKey(req, tier);

    // Retrieve or initialise the window for this key
    let entry = _store.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      _store.set(key, entry);
      _enforceStoreCap();
    }

    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    const resetSecs = Math.ceil(entry.resetAt / 1000);

    // Set standard rate-limit headers on every response
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetSecs);

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);

      log.warn(
        {
          tier,
          key,
          count: entry.count,
          max,
          ip: req.ip,
          userId: req.user?.sub ?? req.user?.id,
          method: req.method,
          url: req.originalUrl,
        },
        'rate limit exceeded'
      );

      return res.status(429).json({
        error: 'Too Many Requests',
        message,
        retryAfter,
      });
    }

    // Attach rate-limit metadata to req for the status endpoint
    req.rateLimit = { tier, limit: max, remaining, resetAt: entry.resetAt };

    return next();
  };
}

// ─── Default middleware instance ─────────────────────────────────────────────

/** Drop-in middleware applying tiered limits based on request identity. */
const rateLimiter = createRateLimiter();

// ─── Exports ─────────────────────────────────────────────────────────────

module.exports = {
  rateLimiter,
  createRateLimiter,
  determineTier,
  _store,
  _resetStore,
  _enforceStoreCap,
  MAX_TRACKED_KEYS,
};

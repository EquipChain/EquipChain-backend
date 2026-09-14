/**
 * src/config/rateLimits.js
 *
 * Tier definitions for the tiered rate limiting middleware (Issue #29).
 *
 * Tiers:
 *  - free:     Unauthenticated or `free`-role users. 60 req/min.
 *  - premium:  `premium`-role users or API keys with `standard`/`premium` tier. 600 req/min.
 *  - admin:    `admin`-role users. 6000 req/min.
 *  - internal: Internal service-to-service API keys. Effectively unlimited (60000 req/min).
 *
 * Each tier definition:
 *  - windowMs  {number}  Rolling window duration in milliseconds.
 *  - max       {number}  Maximum requests allowed in the window.
 *  - message   {string}  Human-readable message returned on 429.
 */

const RATE_LIMIT_TIERS = Object.freeze({
  free: {
    windowMs: 60_000,
    max: 60,
    message: 'Too many requests. Free tier limit is 60 requests per minute.',
  },
  premium: {
    windowMs: 60_000,
    max: 600,
    message: 'Too many requests. Premium tier limit is 600 requests per minute.',
  },
  admin: {
    windowMs: 60_000,
    max: 6_000,
    message: 'Too many requests. Admin tier limit is 6000 requests per minute.',
  },
  internal: {
    windowMs: 60_000,
    max: 60_000,
    message: 'Too many requests. Internal tier limit is 60000 requests per minute.',
  },
});

/**
 * API key tiers that map to the `premium` rate-limit tier.
 * Defined here so both middleware and tests reference a single source of truth.
 */
const PREMIUM_API_KEY_TIERS = Object.freeze(new Set(['standard', 'premium']));

module.exports = { RATE_LIMIT_TIERS, PREMIUM_API_KEY_TIERS };

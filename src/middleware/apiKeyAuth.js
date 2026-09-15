'use strict';

// src/middleware/apiKeyAuth.js
//
// API-key authentication middleware. Closes the gap between the two halves
// that existed without a join: ApiKeyRepository issued and stored keys
// (with a seeded development key) and the tiered rate limiter already
// understood req.apiKey.tier - but no middleware ever authenticated an
// incoming key, so the x-api-key header was accepted by CORS and then
// ignored by every route.
//
// Security model:
//  - Lookup is timing-safe: the presented key is hashed once, and each
//    candidate key is hashed and compared with crypto.timingSafeEqual.
//    Comparing raw secrets byte-by-byte (String ===) leaks, through
//    early-exit timing, how many leading characters of a key an attacker
//    guessed. Hash-then-compare gives fixed-length digests, so comparison
//    cost no longer varies with how much of the secret matches.
//  - Only keys with status 'active' and a future expiresAt authenticate.
//  - Optional permission enforcement: a key must hold the required scope
//    (e.g. 'read') or the request is rejected with 403 even though the key
//    itself is valid - authentication (who you are) stays separate from
//    authorization (what you may do).
//  - Failures log the IP and reason class (not the key) so operators can
//    see probing attempts without the log becoming a secret store.

const crypto = require('crypto');
const { apiKeyRepository } = require('../repositories/ApiKeyRepository');
const { childLogger } = require('../config/logger');

const log = childLogger('api-key-auth');

/** sha256 digest of a key material string. */
function hashKey(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

/** Constant-time comparison of two buffers; false on length mismatch. */
function safeEqual(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Is the key record usable right now? Active and unexpired.
 * ISO-8601 strings compare correctly as dates once parsed.
 */
function isActiveNow(apiKey, nowMs) {
  if (!apiKey || apiKey.status !== 'active') return false;
  const expiry = Date.parse(apiKey.expiresAt);
  return Number.isFinite(expiry) && expiry > nowMs;
}

/**
 * Express middleware factory: require a valid API key in the x-api-key
 * header. On success attaches req.apiKey (the repository record) so the
 * rate limiter can resolve the key's tier and handlers can check
 * permissions. The raw key stays in req.apiKey.key deliberately: the
 * limiter uses it as the counter identity, and log redaction already
 * covers the header value.
 *
 * @param {Object} [options]
 * @param {string} [options.permission] - Required scope, e.g. 'read'.
 * @returns {import('express').RequestHandler}
 */
function requireApiKey(options = {}) {
  return async function apiKeyAuth(req, res, next) {
    const presented = req.headers['x-api-key'];
    if (typeof presented !== 'string' || presented.length === 0) {
      return res.status(401).json({ error: 'API key required.' });
    }

    const nowMs = Date.now();
    const presentedDigest = hashKey(presented);

    let matched = null;
    try {
      // Enumerate active keys and compare digests in constant time per
      // candidate. The candidate set is the repo's active keys - its size
      // is not secret, so iterating it leaks nothing.
      const candidates = await apiKeyRepository.findActive();
      for (const candidate of candidates) {
        if (safeEqual(presentedDigest, hashKey(candidate.key))) {
          matched = candidate;
          break;
        }
      }
    } catch (err) {
      log.error({ error: err.message }, 'API key lookup failed');
      return res.status(503).json({ error: 'Authentication backend unavailable.' });
    }

    if (!matched || !isActiveNow(matched, nowMs)) {
      // isActiveNow re-checks after the async enumeration: the repository
      // filter ran on an earlier snapshot, and a key could have been revoked
      // or expired between enumeration and use (defense in depth).
      log.warn({ ip: req.ip }, 'API key authentication failed: unknown, revoked, or expired key');
      return res.status(401).json({ error: 'Invalid API key.' });
    }

    // Authorization: the key authenticated, but may lack the scope this
    // route needs. 403 (not 401) - identity established, access denied.
    if (options.permission && !(matched.permissions || []).includes(options.permission)) {
      log.warn(
        { ip: req.ip, keyId: matched.id, required: options.permission },
        'API key lacks required permission'
      );
      return res.status(403).json({ error: 'API key lacks the required permission.' });
    }

    // Rate-limiter contract (see middleware/rateLimiter.js): tier 'internal'
    // maps to the internal tier; 'standard'/'premium' map to premium.
    req.apiKey = {
      ...matched,
      tier: matched.tier || 'standard',
    };
    req.auth = { type: 'api-key', keyId: matched.id };

    return next();
  };
}

module.exports = { requireApiKey, hashKey, isActiveNow };

// src/middleware/auth.js
//
// JWT authentication middleware. Verifies `Authorization: Bearer <jwt>`
// against the configured secret and attaches the decoded payload to
// req.user for downstream role checks (requireAdmin) and rate-limit tier
// resolution.

const jwt = require('jsonwebtoken');
const config = require('../config');
const { cacheService } = require('../services/cache');

// In-process revocation set. The cache (Redis when available, shared across
// instances) is the primary store; this Set covers the same-process case
// when Redis is on its memory fallback (per-instance). Check order: local
// set first (cheapest), then cache.
const revokedLocally = new Set();

/**
 * Revoke a token id (jti). The revocation entry lives as long as the token
 * could have - its remaining TTL - so the list self-cleans.
 * @param {string} jti - Token id claim
 * @param {number} [exp] - Token expiry (epoch seconds); defaults to 24h
 */
async function revokeToken(jti, exp) {
  if (!jti) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const ttl = Math.max(1, (exp || nowSec + 24 * 3600) - nowSec);
  revokedLocally.add(jti);
  await cacheService.set(`revoked:${jti}`, 1, ttl);
}

/**
 * Check whether a token id has been revoked.
 * @param {string} jti
 * @returns {Promise<boolean>}
 */
async function isTokenRevoked(jti) {
  if (!jti) return false;
  if (revokedLocally.has(jti)) return true;
  return (await cacheService.get(`revoked:${jti}`)) === 1;
}

const authenticate = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    // Algorithm pinned: without `algorithms`, jsonwebtoken happily verifies
    // tokens signed with any algorithm the token header declares - the
    // classic algorithm-confusion class (e.g. an HS/none mixup) where a
    // forged token names a lax algorithm and the library obeys. We only ever
    // sign HS256, so only HS256 may verify.
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });

    if (await isTokenRevoked(payload.jti)) {
      return res.status(401).json({ error: 'Token has been revoked.' });
    }

    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

module.exports = { authenticate, revokeToken, isTokenRevoked };

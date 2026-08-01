// src/middleware/cache.js
//
// Express middleware for automatic GET response caching (issue #12).
// Only caches GET requests. Varies cache key by URL + query + auth status.

const { cache, TTL_PRESETS } = require('../services/cache');
const { childLogger } = require('../config/logger');

const log = childLogger('middleware:cache');

/**
 * Determine TTL from the request path.
 * /api/meters/* → meter TTL (60s)
 * /api/admin/config/* → config TTL (300s)
 * /api/analytics/* → analytics TTL (120s)
 * default → 60s
 */
function getTTL(path) {
  if (path.includes('/config')) return TTL_PRESETS.config;
  if (path.includes('/analytics')) return TTL_PRESETS.analytics;
  if (path.includes('/meter')) return TTL_PRESETS.meter;
  return TTL_PRESETS.default;
}

/**
 * Build a cache key from request.
 */
function buildCacheKey(req) {
  const path = req.originalUrl || req.url;
  const authStatus = req.headers.authorization ? 'authed' : 'anon';
  return `equipchain:http:${authStatus}:${Buffer.from(path).toString('base64url')}`;
}

/**
 * Cache middleware factory.
 * @param {number} ttl - Cache TTL in seconds (overrides auto-detection)
 */
function cacheMiddleware(ttl) {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    const key = buildCacheKey(req);
    const effectiveTTL = ttl || getTTL(req.path);

    // Try cache first
    const cached = await cache.get(key);
    if (cached) {
      log.debug({ key }, 'Cache hit');
      res.set('X-Cache', 'HIT');
      res.set('X-Cache-TTL', effectiveTTL.toString());
      return res.json(cached);
    }

    // Intercept res.json to cache the response
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      // Only cache successful responses (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300 && body) {
        cache.set(key, body, effectiveTTL).catch((err) => {
          log.error({ err: err.message, key }, 'Failed to cache response');
        });
      }

      res.set('X-Cache', 'MISS');
      return originalJson(body);
    };

    next();
  };
}

/**
 * Cache invalidation helper — call after write operations.
 * @param {string} entity - Entity type (meter, config, etc.)
 * @param {string} id - Entity ID
 */
async function invalidateCache(entity, id) {
  return cache.invalidate(entity, id);
}

module.exports = { cacheMiddleware, invalidateCache, getTTL, buildCacheKey };

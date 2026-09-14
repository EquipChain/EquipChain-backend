// src/services/cache.js
//
// Redis caching service wrapper with TTL support.
// Provides get/set/delete/flush operations and a memoize helper for
// caching expensive function results (e.g., Soroban/blockchain queries).
// Falls back gracefully to in-memory cache when Redis is unavailable.

const { childLogger } = require('../config/logger');

const log = childLogger('cache');

// ---------------------------------------------------------------------------
// In-memory fallback store
// ---------------------------------------------------------------------------
// Used when Redis is unreachable. A Map grows without bound, and the fallback
// path can be active for days (e.g. a forgotten Redis container), so the
// store is capped: once MEMORY_STORE_MAX_ENTRIES is reached, insertion evicts
// expired entries first, then the oldest (Map preserves insertion order).
// A single flat cap bounds worst-case memory deterministically - far safer
// than per-entry byte accounting, which the payload-size variance here
// (small analytics payloads) does not justify.
const memoryStore = new Map();
let memoryStoreEvictions = 0;

// Cap is read from the env lazily (memoised by raw value) so operators can
// tune MEMORY_STORE_MAX_ENTRIES at runtime and tests can shrink it.
let _cachedMaxRaw;
let _cachedMaxValue;
function memoryStoreMaxEntries() {
  const raw = process.env.MEMORY_STORE_MAX_ENTRIES || '10000';
  if (raw !== _cachedMaxRaw) {
    const parsed = parseInt(raw, 10);
    _cachedMaxRaw = raw;
    _cachedMaxValue = Number.isFinite(parsed) && parsed >= 1 ? parsed : 10000;
  }
  return _cachedMaxValue;
}

/**
 * Insert into the fallback store with bounded memory: evict expired entries
 * first, then oldest, until there is room. Exported counters surface the
 * eviction pressure in cache stats.
 */
function memoryStoreSet(key, entry) {
  const maxEntries = memoryStoreMaxEntries();
  if (memoryStore.size >= maxEntries && !memoryStore.has(key)) {
    const now = Date.now();
    for (const [existingKey, existing] of memoryStore) {
      if (memoryStore.size < maxEntries) break;
      if (existing.expiry && now > existing.expiry) {
        memoryStore.delete(existingKey);
        memoryStoreEvictions++;
      }
    }
    while (memoryStore.size >= maxEntries) {
      const oldestKey = memoryStore.keys().next().value;
      memoryStore.delete(oldestKey);
      memoryStoreEvictions++;
    }
  }
  memoryStore.set(key, entry);
}

// ---------------------------------------------------------------------------
// Stampede protection
// ---------------------------------------------------------------------------
// In-flight getOrSet promises keyed by cache key. When N concurrent requests
// miss the same key, all N share one load() execution instead of N loads
// hammering the backing store (classic thundering-herd on a hot key after a
// deploy or TTL expiry).
const inFlightGets = new Map();

// ---------------------------------------------------------------------------
// CacheService
// ---------------------------------------------------------------------------
class CacheService {
  /**
   * @param {Object} options
   * @param {string} [options.url] - Redis connection URL
   * @param {number} [options.defaultTTL] - Default TTL in seconds
   * @param {boolean} [options.enabled] - Enable/disable caching
   */
  constructor(options = {}) {
    this._url = options.url || process.env.REDIS_URL || 'redis://localhost:6379';
    this._defaultTTL = options.defaultTTL || 3600; // 1 hour
    this._enabled = options.enabled !== false;
    this._client = null;
    this._connected = false;
    this._useMemory = false;
  }

  /**
   * Initialize the Redis connection. Falls back to in-memory on failure.
   */
  async connect() {
    if (!this._enabled) {
      log.info('Cache service disabled');
      return;
    }

    try {
      const Redis = require('ioredis');
      this._client = new Redis(this._url, {
        maxRetriesPerRequest: 3,
        // Fail fast per command while reconnecting: with the default
        // offline queue, a Redis blip makes every cached request hang for
        // the full connect timeout instead of falling through to the
        // memory fallback - a cache outage became an API latency outage.
        enableOfflineQueue: false,
        connectTimeout: 3000,
        retryStrategy(times) {
          if (times > 3) {
            log.warn('Redis connection failed after 3 retries, using in-memory cache');
            return null; // Stop retrying
          }
          return Math.min(times * 200, 2000);
        },
        // Reconnect forever, but with backoff: a Redis restart should
        // transparently re-attach the cache rather than require a deploy.
        // (retryStrategy returning null above only stops the INITIAL
        // connect attempt from being retried.)
        reconnectOnError() {
          return 1000;
        },
        lazyConnect: true,
      });

      this._client.on('error', (err) => {
        if (!this._useMemory) {
          log.warn({ error: err.message }, 'Redis error, falling back to in-memory cache');
          this._useMemory = true;
          this._connected = false;
        }
      });

      this._client.on('connect', () => {
        this._connected = true;
        this._useMemory = false;
        log.info('Redis connected');
      });

      this._client.on('close', () => {
        this._connected = false;
      });

      await this._client.connect();
      this._connected = true;
      log.info({ url: this._url }, 'Cache service initialized');
    } catch (err) {
      log.warn({ error: err.message }, 'Redis unavailable, using in-memory cache');
      this._useMemory = true;
    }
  }

  /**
   * Get a cached value by key.
   * @param {string} key
   * @returns {Promise<any|null>}
   */
  async get(key) {
    if (!this._enabled) return null;

    try {
      if (this._useMemory) {
        const entry = memoryStore.get(key);
        if (!entry) return null;
        if (entry.expiry && Date.now() > entry.expiry) {
          memoryStore.delete(key);
          return null;
        }
        return JSON.parse(entry.value);
      }

      if (!this._client) return null;
      const value = await this._client.get(key);
      if (value === null) return null;
      return JSON.parse(value);
    } catch (err) {
      log.error({ error: err.message, key }, 'Cache get error');
      return null;
    }
  }

  /**
   * Set a value in cache with optional TTL.
   * @param {string} key
   * @param {any} value
   * @param {number} [ttl] - TTL in seconds (uses defaultTTL if not provided)
   */
  async set(key, value, ttl) {
    if (!this._enabled) return;

    const resolvedTTL = ttl || this._defaultTTL;

    try {
      const serialized = JSON.stringify(value);

      if (this._useMemory) {
        memoryStoreSet(key, {
          value: serialized,
          expiry: resolvedTTL > 0 ? Date.now() + resolvedTTL * 1000 : null,
        });
        return;
      }

      if (!this._client) return;
      if (resolvedTTL > 0) {
        await this._client.setex(key, resolvedTTL, serialized);
      } else {
        await this._client.set(key, serialized);
      }
    } catch (err) {
      log.error({ error: err.message, key }, 'Cache set error');
    }
  }

  /**
   * Delete a cached value.
   * @param {string} key
   */
  async del(key) {
    if (!this._enabled) return;

    try {
      if (this._useMemory) {
        memoryStore.delete(key);
        return;
      }

      if (!this._client) return;
      await this._client.del(key);
    } catch (err) {
      log.error({ error: err.message, key }, 'Cache delete error');
    }
  }

  /**
   * Delete all keys matching a pattern.
   * @param {string} pattern - Glob pattern (e.g., 'analytics:*')
   */
  async delPattern(pattern) {
    if (!this._enabled) return;

    try {
      if (this._useMemory) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        for (const key of memoryStore.keys()) {
          if (regex.test(key)) {
            memoryStore.delete(key);
          }
        }
        return;
      }

      if (!this._client) return;
      // SCAN instead of KEYS: KEYS scans the whole keyspace synchronously
      // and blocks the Redis event loop - O(N) on every call, which with a
      // large cache stalls ALL commands (including health checks) while it
      // runs. SCAN iterates in bounded chunks, keeping Redis responsive.
      let cursor = '0';
      const keys = [];
      do {
        const [next, batch] = await this._client.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
        cursor = next;
        keys.push(...batch);
      } while (cursor !== '0');
      if (keys.length > 0) {
        await this._client.del(...keys);
      }
    } catch (err) {
      log.error({ error: err.message, pattern }, 'Cache delPattern error');
    }
  }

  /**
   * Flush all cached data.
   */
  async flush() {
    if (!this._enabled) return;

    try {
      if (this._useMemory) {
        memoryStore.clear();
        return;
      }

      if (!this._client) return;
      await this._client.flushdb();
    } catch (err) {
      log.error({ error: err.message }, 'Cache flush error');
    }
  }

  /**
   * Cache-aside with stampede protection: many concurrent callers asking for
   * the same missing key trigger exactly one load(); every caller receives
   * the same resolved value (or the same rejection - a failed load is not
   * cached, so the next request retries).
   *
   * @param {string} key
   * @param {number} [ttl] - TTL in seconds when storing the loaded value
   * @param {() => Promise<any>} load - miss handler producing the value
   * @returns {Promise<any>}
   */
  async getOrSet(key, ttl, load) {
    const cached = await this.get(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }

    const existing = inFlightGets.get(key);
    if (existing) {
      return existing.promise;
    }

    const promise = (async () => {
      try {
        const value = await load();
        // Only cache defined values: a null/undefined result (e.g. entity
        // not found) is intentionally not stored so negative results never
        // outlive the request that produced them.
        if (value !== null && value !== undefined) {
          await this.set(key, value, ttl);
        }
        return value;
      } finally {
        inFlightGets.delete(key);
      }
    })();

    inFlightGets.set(key, { promise });
    return promise;
  }

  /**
   * Check if the cache is connected and operational.
   * @returns {boolean}
   */
  isConnected() {
    return this._connected || this._useMemory;
  }

  /**
   * Get cache statistics.
   * @returns {Promise<Object>}
   */
  async getStats() {
    if (this._useMemory) {
      return {
        type: 'memory',
        keys: memoryStore.size,
        connected: true,
        maxEntries: memoryStoreMaxEntries(),
        evictions: memoryStoreEvictions,
      };
    }

    if (!this._client) {
      return { type: 'none', keys: 0, connected: false };
    }

    try {
      const info = await this._client.info('keyspace');
      const dbMatch = info.match(/db0:keys=(\d+)/);
      return {
        type: 'redis',
        keys: dbMatch ? parseInt(dbMatch[1], 10) : 0,
        connected: this._connected,
      };
    } catch (err) {
      return { type: 'redis', keys: 0, connected: false, error: err.message };
    }
  }

  /**
   * Close the Redis connection and clean up.
   */
  async quit() {
    try {
      if (this._client) {
        await this._client.quit();
        this._client = null;
        this._connected = false;
      }
    } catch (err) {
      log.error({ error: err.message }, 'Cache quit error');
    }
  }
}

// Singleton instance
const cacheService = new CacheService();

module.exports = { CacheService, cacheService };

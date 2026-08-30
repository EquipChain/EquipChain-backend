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
const memoryStore = new Map();

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
        retryStrategy(times) {
          if (times > 3) {
            log.warn('Redis connection failed after 3 retries, using in-memory cache');
            return null; // Stop retrying
          }
          return Math.min(times * 200, 2000);
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
        memoryStore.set(key, {
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
      const keys = await this._client.keys(pattern);
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

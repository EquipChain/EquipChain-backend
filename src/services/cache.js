// src/services/cache.js
//
// Redis caching abstraction for EquipChain blockchain data queries (issue #12).
// Uses ioredis with graceful fallback when Redis is unavailable.

const Redis = require('ioredis');
const { childLogger } = require('../config/logger');

const log = childLogger('cache');

const {
  REDIS_URL = 'redis://localhost:6379',
  REDIS_PASSWORD = '',
  CACHE_DEFAULT_TTL = '60',
} = process.env;

const DEFAULT_TTL = parseInt(CACHE_DEFAULT_TTL, 10) || 60;

// TTL presets by entity type (seconds)
const TTL_PRESETS = {
  meter: 60,        // meter readings change frequently
  config: 300,      // configuration data changes rarely
  analytics: 120,   // aggregated analytics
  default: DEFAULT_TTL,
};

/**
 * CacheService — wraps ioredis with graceful degradation.
 * Falls back to no-cache mode when Redis is down.
 */
class CacheService {
  constructor(url = REDIS_URL, password = REDIS_PASSWORD) {
    this.url = url;
    this.password = password || undefined;
    this.connected = false;
    this.client = null;
    this.stats = { hits: 0, misses: 0, errors: 0, sets: 0, deletes: 0 };

    this._connect();
  }

  _connect() {
    try {
      const opts = {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 10) {
            log.warn('Redis retry limit reached — caching disabled');
            return null; // stop retrying
          }
          return Math.min(times * 100, 2000); // exponential backoff capped at 2s
        },
        enableOfflineQueue: true,
        lazyConnect: false,
      };

      if (this.password) {
        opts.password = this.password;
      }

      this.client = new Redis(this.url, opts);

      this.client.on('connect', () => {
        this.connected = true;
        log.info('Redis cache connected');
      });

      this.client.on('error', (err) => {
        this.connected = false;
        this.stats.errors++;
        log.error({ err: err.message }, 'Redis cache error');
      });

      this.client.on('close', () => {
        this.connected = false;
        log.warn('Redis cache connection closed');
      });

      this.client.on('reconnecting', (delay) => {
        log.info({ delay }, 'Redis cache reconnecting');
      });

    } catch (err) {
      log.warn({ err: err.message }, 'Redis init failed — caching disabled');
      this.connected = false;
    }
  }

  /**
   * Build a cache key following the naming convention.
   * equipchain:{entity}:{id}:{field}
   */
  buildKey(entity, id, field = '') {
    const parts = ['equipchain', entity, id];
    if (field) parts.push(field);
    return parts.join(':');
  }

  /**
   * Get a value from cache. Returns null on miss or error.
   */
  async get(key) {
    if (!this.connected) {
      this.stats.misses++;
      return null;
    }

    try {
      const raw = await this.client.get(key);
      if (raw === null) {
        this.stats.misses++;
        return null;
      }
      this.stats.hits++;
      return JSON.parse(raw);
    } catch (err) {
      this.stats.errors++;
      log.error({ err: err.message, key }, 'Cache get error');
      return null;
    }
  }

  /**
   * Set a value in cache with TTL (seconds).
   */
  async set(key, value, ttl = DEFAULT_TTL) {
    if (!this.connected) return false;

    try {
      const serialized = JSON.stringify(value);
      if (ttl > 0) {
        await this.client.setex(key, ttl, serialized);
      } else {
        await this.client.set(key, serialized);
      }
      this.stats.sets++;
      return true;
    } catch (err) {
      this.stats.errors++;
      log.error({ err: err.message, key }, 'Cache set error');
      return false;
    }
  }

  /**
   * Delete a key from cache.
   */
  async del(key) {
    if (!this.connected) return false;

    try {
      await this.client.del(key);
      this.stats.deletes++;
      return true;
    } catch (err) {
      this.stats.errors++;
      log.error({ err: err.message, key }, 'Cache del error');
      return false;
    }
  }

  /**
   * Flush keys matching a pattern (glob-style).
   */
  async flush(pattern) {
    if (!this.connected) return 0;

    try {
      const keys = await this.client.keys(pattern);
      if (keys.length === 0) return 0;

      // Delete in batches to avoid blocking Redis
      const batchSize = 100;
      let deleted = 0;
      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        deleted += await this.client.del(...batch);
      }

      log.info({ pattern, deleted }, 'Cache flushed');
      return deleted;
    } catch (err) {
      this.stats.errors++;
      log.error({ err: err.message, pattern }, 'Cache flush error');
      return 0;
    }
  }

  /**
   * Invalidate cache for a specific entity (e.g., after a write).
   */
  async invalidate(entity, id) {
    return this.flush(`equipchain:${entity}:${id}:*`);
  }

  /**
   * Warm the cache for high-priority queries.
   * @param {Array<{key: string, fetcher: () => Promise<any>, ttl: number}>} entries
   */
  async warm(entries) {
    for (const { key, fetcher, ttl } of entries) {
      try {
        const value = await fetcher();
        if (value !== null && value !== undefined) {
          await this.set(key, value, ttl || DEFAULT_TTL);
        }
      } catch (err) {
        log.error({ err: err.message, key }, 'Cache warm error');
      }
    }
  }

  /**
   * Get cache health and stats.
   */
  health() {
    return {
      connected: this.connected,
      stats: { ...this.stats },
      hitRate: this.stats.hits + this.stats.misses > 0
        ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2) + '%'
        : '0%',
    };
  }

  /**
   * Gracefully close the connection.
   */
  async quit() {
    if (this.client) {
      await this.client.quit();
    }
  }
}

// Singleton instance
const cache = new CacheService();

module.exports = { cache, CacheService, TTL_PRESETS };

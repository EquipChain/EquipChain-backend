// tests/unit/cache.test.js
//
// Unit tests for the CacheService (issue #12).
// Tests use a mock Redis client — no real Redis required.

const { CacheService, TTL_PRESETS } = require('../../src/services/cache');

// Mock ioredis
jest.mock('ioredis', () => {
  const store = new Map();
  const Redis = jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    get: jest.fn(async (key) => store.get(key) || null),
    set: jest.fn(async (key, val) => { store.set(key, val); return 'OK'; }),
    setex: jest.fn(async (key, ttl, val) => { store.set(key, val); return 'OK'; }),
    del: jest.fn(async (...keys) => {
      let count = 0;
      keys.forEach(k => { if (store.delete(k)) count++; });
      return count;
    }),
    keys: jest.fn(async (pattern) => {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return Array.from(store.keys()).filter(k => regex.test(k));
    }),
    quit: jest.fn(async () => 'OK'),
  }));
  return Redis;
});

describe('CacheService', () => {
  let cache;

  beforeEach(() => {
    cache = new CacheService('redis://localhost:6379');
    cache.connected = true;
  });

  describe('buildKey', () => {
    test('builds key with entity, id, and field', () => {
      expect(cache.buildKey('meter', 'device123', 'lastReading'))
        .toBe('equipchain:meter:device123:lastReading');
    });

    test('builds key without field', () => {
      expect(cache.buildKey('meter', 'device123'))
        .toBe('equipchain:meter:device123');
    });
  });

  describe('get', () => {
    test('returns null on miss', async () => {
      const result = await cache.get('nonexistent');
      expect(result).toBeNull();
      expect(cache.stats.misses).toBe(1);
    });

    test('returns parsed JSON on hit', async () => {
      await cache.set('test:key', { value: 42 }, 60);
      const result = await cache.get('test:key');
      expect(result).toEqual({ value: 42 });
      expect(cache.stats.hits).toBe(1);
    });
  });

  describe('set', () => {
    test('stores JSON-serialized value', async () => {
      const obj = { id: 'meter-001', reading: 1234.56 };
      const result = await cache.set('test:set', obj, 30);
      expect(result).toBe(true);
      expect(cache.stats.sets).toBe(1);
    });

    test('stores with TTL via setex', async () => {
      await cache.set('test:ttl', 'hello', 60);
      expect(cache.client.setex).toHaveBeenCalled();
    });
  });

  describe('del', () => {
    test('deletes a key', async () => {
      await cache.set('test:del', 'value', 60);
      const result = await cache.del('test:del');
      expect(result).toBe(true);
    });
  });

  describe('flush', () => {
    test('flushes keys matching pattern', async () => {
      await cache.set('equipchain:meter:001:reading', 100, 60);
      await cache.set('equipchain:meter:002:reading', 200, 60);
      await cache.set('other:key', 'value', 60);

      const deleted = await cache.flush('equipchain:meter:*');
      expect(deleted).toBe(2);
    });
  });

  describe('invalidate', () => {
    test('invalidates all keys for an entity', async () => {
      await cache.set('equipchain:meter:001:reading', 100, 60);
      await cache.set('equipchain:meter:001:status', 'online', 60);
      await cache.set('equipchain:meter:002:reading', 200, 60);

      const deleted = await cache.invalidate('meter', '001');
      expect(deleted).toBe(2);
    });
  });

  describe('warm', () => {
    test('warms cache from fetcher functions', async () => {
      const entries = [
        { key: 'warm:1', fetcher: async () => ({ data: 'hot' }), ttl: 60 },
        { key: 'warm:2', fetcher: async () => ({ data: 'cold' }), ttl: 60 },
      ];
      await cache.warm(entries);
      const result = await cache.get('warm:1');
      expect(result).toEqual({ data: 'hot' });
    });
  });

  describe('health', () => {
    test('reports connection status and stats', () => {
      cache.stats = { hits: 10, misses: 5, errors: 0, sets: 10, deletes: 2 };
      const h = cache.health();
      expect(h.connected).toBe(true);
      expect(h.stats.hits).toBe(10);
      expect(h.hitRate).toBe('66.67%');
    });
  });

  describe('graceful fallback', () => {
    test('returns null when disconnected', async () => {
      cache.connected = false;
      const result = await cache.get('any:key');
      expect(result).toBeNull();
    });

    test('set returns false when disconnected', async () => {
      cache.connected = false;
      const result = await cache.set('any:key', 'value', 60);
      expect(result).toBe(false);
    });
  });
});

describe('TTL_PRESETS', () => {
  test('has correct preset values', () => {
    expect(TTL_PRESETS.meter).toBe(60);
    expect(TTL_PRESETS.config).toBe(300);
    expect(TTL_PRESETS.analytics).toBe(120);
    expect(TTL_PRESETS.default).toBe(60);
  });
});

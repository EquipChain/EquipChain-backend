const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { CacheService } = require('../src/services/cache');

describe('Cache Service', () => {
  let cache;

  beforeEach(() => {
    // Use a new CacheService instance with Redis disabled (memory-only)
    cache = new CacheService({ enabled: true });
    cache._useMemory = true;
    cache._connected = true;
  });

  afterEach(async () => {
    await cache.flush();
  });

  test('should set and get a value', async () => {
    await cache.set('test-key', { hello: 'world' });
    const value = await cache.get('test-key');
    assert.deepStrictEqual(value, { hello: 'world' });
  });

  test('should return null for non-existent key', async () => {
    const value = await cache.get('non-existent');
    assert.strictEqual(value, null);
  });

  test('should delete a key', async () => {
    await cache.set('test-key', 'value');
    await cache.del('test-key');
    const value = await cache.get('test-key');
    assert.strictEqual(value, null);
  });

  test('should flush all data', async () => {
    await cache.set('key1', 'value1');
    await cache.set('key2', 'value2');
    await cache.flush();
    assert.strictEqual(await cache.get('key1'), null);
    assert.strictEqual(await cache.get('key2'), null);
  });

  test('should respect TTL', async () => {
    // Set with very short TTL (1 second)
    await cache.set('ttl-key', 'expires-soon', 1);
    const value1 = await cache.get('ttl-key');
    assert.strictEqual(value1, 'expires-soon');

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const value2 = await cache.get('ttl-key');
    assert.strictEqual(value2, null);
  });

  test('should handle pattern deletion', async () => {
    await cache.set('analytics:daily', 'data1');
    await cache.set('analytics:monthly', 'data2');
    await cache.set('meter:data', 'data3');

    await cache.delPattern('analytics:*');

    assert.strictEqual(await cache.get('analytics:daily'), null);
    assert.strictEqual(await cache.get('analytics:monthly'), null);
    assert.strictEqual(await cache.get('meter:data'), 'data3');
  });

  test('should report stats', async () => {
    await cache.set('key1', 'value1');
    await cache.set('key2', 'value2');

    const stats = await cache.getStats();
    assert.strictEqual(stats.type, 'memory');
    assert.strictEqual(stats.keys, 2);
    assert.strictEqual(stats.connected, true);
  });

  test('should return false when disabled', async () => {
    const disabledCache = new CacheService({ enabled: false });
    await disabledCache.set('key', 'value');
    const value = await disabledCache.get('key');
    assert.strictEqual(value, null);
  });

  test('should handle complex nested objects', async () => {
    const complex = {
      array: [1, 2, 3],
      nested: { a: { b: { c: 'deep' } } },
      date: '2026-01-15T00:00:00Z',
      number: 42,
      boolean: true,
    };

    await cache.set('complex', complex);
    const retrieved = await cache.get('complex');
    assert.deepStrictEqual(retrieved, complex);
  });
});

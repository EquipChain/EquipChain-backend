const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  addReadings,
  getReadings,
  clearReadings,
  readingCount,
  aggregateReadings,
  fleetSummary,
  comparePeriods,
  aggregateValues,
  percentile,
  getBucketKey,
  generateBucketKeys,
} = require('../src/services/aggregator');

describe('Aggregator Service', () => {
  beforeEach(() => {
    clearReadings();
  });

  describe('Data Store', () => {
    test('should add a single reading', () => {
      const reading = addReadings({
        meterId: 'METER-001',
        timestamp: '2026-01-15T08:00:00Z',
        value: 123.45,
        unit: 'kWh',
      });

      assert.strictEqual(reading.meterId, 'METER-001');
      assert.strictEqual(reading.value, 123.45);
      assert.strictEqual(reading.unit, 'kWh');
      assert.ok(reading.id);
    });

    test('should add multiple readings', () => {
      const readings = addReadings([
        { meterId: 'METER-001', timestamp: '2026-01-15T08:00:00Z', value: 100 },
        { meterId: 'METER-002', timestamp: '2026-01-15T08:00:00Z', value: 200 },
      ]);

      assert.ok(Array.isArray(readings));
      assert.strictEqual(readings.length, 2);
    });

    test('should get readings with filters', () => {
      addReadings({ meterId: 'METER-001', timestamp: '2026-01-15T08:00:00Z', value: 100 });
      addReadings({ meterId: 'METER-002', timestamp: '2026-01-15T09:00:00Z', value: 200 });

      const filtered = getReadings({ meterIds: ['METER-001'] });
      assert.strictEqual(filtered.length, 1);
      assert.strictEqual(filtered[0].meterId, 'METER-001');
    });

    test('should clear readings', () => {
      addReadings({ meterId: 'METER-001', timestamp: '2026-01-15T08:00:00Z', value: 100 });
      clearReadings();
      assert.strictEqual(readingCount(), 0);
    });
  });

  describe('Aggregation Functions', () => {
    test('should calculate percentile correctly', () => {
      const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      assert.strictEqual(percentile(sorted, 50), 5.5);
      assert.strictEqual(percentile(sorted, 0), 1);
      assert.strictEqual(percentile(sorted, 100), 10);
    });

    test('should aggregate values by type', () => {
      const values = [10, 20, 30, 40, 50];

      assert.strictEqual(aggregateValues(values, 'count'), 5);
      assert.strictEqual(aggregateValues(values, 'sum'), 150);
      assert.strictEqual(aggregateValues(values, 'avg'), 30);
      assert.strictEqual(aggregateValues(values, 'min'), 10);
      assert.strictEqual(aggregateValues(values, 'max'), 50);
    });

    test('should return null for empty array (non-count)', () => {
      assert.strictEqual(aggregateValues([], 'avg'), null);
      assert.strictEqual(aggregateValues([], 'sum'), null);
    });

    test('should return 0 for empty array (count)', () => {
      assert.strictEqual(aggregateValues([], 'count'), 0);
    });

    test('should throw on unknown aggregation type', () => {
      assert.throws(() => aggregateValues([1, 2, 3], 'unknown'), /Unknown aggregation type/);
    });
  });

  describe('Bucket Key Generation', () => {
    test('should generate correct day bucket key', () => {
      const ts = new Date('2026-01-15T14:30:00Z').getTime();
      assert.strictEqual(getBucketKey(ts, 'day'), '2026-01-15');
    });

    test('should generate correct hour bucket key', () => {
      const ts = new Date('2026-01-15T14:30:00Z').getTime();
      assert.strictEqual(getBucketKey(ts, 'hour'), '2026-01-15T14:00:00Z');
    });

    test('should generate correct month bucket key', () => {
      const ts = new Date('2026-01-15T14:30:00Z').getTime();
      assert.strictEqual(getBucketKey(ts, 'month'), '2026-01');
    });

    test('should generate correct week bucket key', () => {
      // Wednesday Jan 15, 2026 -> Monday Jan 13, 2026
      const ts = new Date('2026-01-15T14:30:00Z').getTime();
      assert.strictEqual(getBucketKey(ts, 'week'), '2026-01-13');
    });

    test('should generate all bucket keys between dates', () => {
      const keys = generateBucketKeys('2026-01-01', '2026-01-03', 'day');
      assert.deepStrictEqual(keys, ['2026-01-01', '2026-01-02', '2026-01-03']);
    });
  });

  describe('Aggregate Readings', () => {
    test('should aggregate readings into daily buckets', () => {
      addReadings({ meterId: 'M-1', timestamp: new Date('2026-01-15T08:00:00Z').getTime(), value: 100 });
      addReadings({ meterId: 'M-1', timestamp: new Date('2026-01-15T20:00:00Z').getTime(), value: 200 });
      addReadings({ meterId: 'M-1', timestamp: new Date('2026-01-16T08:00:00Z').getTime(), value: 150 });

      const result = aggregateReadings(getReadings(), {
        startDate: '2026-01-15',
        endDate: '2026-01-16',
        granularity: 'day',
        aggregationType: 'avg',
      });

      assert.ok(Array.isArray(result));
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].key, '2026-01-15');
      assert.strictEqual(result[0].count, 2);
      assert.strictEqual(result[0].value, 150); // avg of 100 and 200
    });

    test('should fill gaps with null values', () => {
      addReadings({ meterId: 'M-1', timestamp: new Date('2026-01-15T08:00:00Z').getTime(), value: 100 });

      const result = aggregateReadings(getReadings(), {
        startDate: '2026-01-15',
        endDate: '2026-01-17',
        granularity: 'day',
        aggregationType: 'avg',
      });

      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[1].value, null); // No data for Jan 16
      assert.strictEqual(result[1].count, 0);
    });
  });

  describe('Fleet Summary', () => {
    test('should compute fleet-wide summary', () => {
      addReadings({ meterId: 'M-1', timestamp: Date.now(), value: 100 });
      addReadings({ meterId: 'M-2', timestamp: Date.now(), value: 200 });

      const summary = fleetSummary(getReadings());

      assert.strictEqual(summary.fleet.totalMeters, 2);
      assert.strictEqual(summary.fleet.totalReadings, 2);
      assert.strictEqual(summary.meters.length, 2);
      assert.ok(summary.topPerformer);
      assert.ok(summary.bottomPerformer);
    });
  });

  describe('Compare Periods', () => {
    test('should compare two periods', () => {
      const current = [{ key: '2026-01', value: 100, count: 5 }];
      const previous = [{ key: '2025-12', value: 80, count: 4 }];

      const result = comparePeriods(current, previous);

      assert.strictEqual(result.comparison.delta, 20);
      assert.ok(result.comparison.percentageChange > 0);
    });
  });
});

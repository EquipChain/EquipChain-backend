const { describe, it, before, after } = require('node:test');
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
} = require('../src/services/aggregator');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReading(meterId, dateStr, value, hour = 12) {
  const date = new Date(dateStr);
  date.setUTCHours(hour, 0, 0, 0);
  return { meterId, timestamp: date.getTime(), value, unit: 'kWh' };
}

const M1 = 'METER-001';
const M2 = 'METER-002';

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

before(() => clearReadings());
after(() => clearReadings());

// ---------------------------------------------------------------------------
// percentile
// ---------------------------------------------------------------------------

describe('percentile', () => {
  it('returns 0 for empty array', () => {
    assert.strictEqual(percentile([], 50), 0);
  });

  it('returns the only value for single-element array', () => {
    assert.strictEqual(percentile([42], 50), 42);
  });

  it('computes p50 (median) for odd-length sorted array', () => {
    assert.strictEqual(percentile([1, 2, 3, 4, 5], 50), 3);
  });

  it('computes p50 for even-length sorted array', () => {
    assert.strictEqual(percentile([1, 2, 3, 4], 50), 2.5);
  });

  it('computes p95 correctly', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const result = percentile(values, 95);
    // 95th percentile = 95% of 19 = 18.05, value at index 18 plus 0.05*(value at 19 - value at 18)
    const expected = 19 + 0.05 * (20 - 19);
    assert.strictEqual(result, expected);
  });
});

// ---------------------------------------------------------------------------
// aggregateValues
// ---------------------------------------------------------------------------

describe('aggregateValues', () => {
  const values = [10, 20, 30, 40, 50];

  it('returns 0 for count on empty array', () => {
    assert.strictEqual(aggregateValues([], 'count'), 0);
  });

  it('returns null for non-count aggregation on empty array', () => {
    assert.strictEqual(aggregateValues([], 'avg'), null);
  });

  it('computes count', () => {
    assert.strictEqual(aggregateValues(values, 'count'), 5);
  });

  it('computes sum', () => {
    assert.strictEqual(aggregateValues(values, 'sum'), 150);
  });

  it('computes avg', () => {
    assert.strictEqual(aggregateValues(values, 'avg'), 30);
  });

  it('computes min', () => {
    assert.strictEqual(aggregateValues(values, 'min'), 10);
  });

  it('computes max', () => {
    assert.strictEqual(aggregateValues(values, 'max'), 50);
  });

  it('computes p50 (median)', () => {
    assert.strictEqual(aggregateValues(values, 'p50'), 30);
  });

  it('computes p95', () => {
    const result = aggregateValues(values, 'p95');
    assert.ok(result > 0);
  });
});

// ---------------------------------------------------------------------------
// getBucketKey
// ---------------------------------------------------------------------------

describe('getBucketKey', () => {
  it('returns hourly key', () => {
    const ts = new Date('2026-01-15T14:30:00Z').getTime();
    assert.strictEqual(getBucketKey(ts, 'hour'), '2026-01-15T14:00:00Z');
  });

  it('returns daily key', () => {
    const ts = new Date('2026-01-15T14:30:00Z').getTime();
    assert.strictEqual(getBucketKey(ts, 'day'), '2026-01-15');
  });

  it('returns weekly key (Monday of the week)', () => {
    // 2026-01-15 is a Thursday
    const ts = new Date('2026-01-15T14:30:00Z').getTime();
    assert.strictEqual(getBucketKey(ts, 'week'), '2026-01-12');
  });

  it('returns monthly key', () => {
    const ts = new Date('2026-01-15T14:30:00Z').getTime();
    assert.strictEqual(getBucketKey(ts, 'month'), '2026-01');
  });
});

// ---------------------------------------------------------------------------
// Data Store
// ---------------------------------------------------------------------------

describe('data store', () => {
  before(() => clearReadings());
  after(() => clearReadings());

  it('addReadings stores a single reading', () => {
    const r = addReadings({ meterId: M1, timestamp: Date.now(), value: 100 });
    assert.ok(r.id);
    assert.strictEqual(r.meterId, M1);
    assert.strictEqual(r.value, 100);
  });

  it('getReadings returns all readings', () => {
    const count = readingCount();
    assert.ok(count > 0);
    const all = getReadings();
    assert.strictEqual(all.length, count);
  });

  it('getReadings filters by meterId', () => {
    const m1Readings = getReadings({ meterIds: [M1] });
    const m2Readings = getReadings({ meterIds: [M2] });
    assert.ok(m1Readings.every((r) => r.meterId === M1));
    assert.ok(m2Readings.every((r) => r.meterId === M2));
  });

  it('getReadings filters by date range', () => {
    const now = Date.now();
    const readingsInRange = getReadings({
      startDate: new Date(now - 3600000).toISOString(),
      endDate: new Date(now + 3600000).toISOString(),
    });
    assert.ok(readingsInRange.length > 0);
  });

  it('clearReadings empties the store', () => {
    clearReadings();
    assert.strictEqual(readingCount(), 0);
    assert.strictEqual(getReadings().length, 0);
  });
});

// ---------------------------------------------------------------------------
// aggregateReadings
// ---------------------------------------------------------------------------

describe('aggregateReadings', () => {
  before(() => {
    clearReadings();
    addReadings([
      makeReading(M1, '2026-01-01', 100),
      makeReading(M1, '2026-01-01', 200),
      makeReading(M1, '2026-01-02', 150),
      makeReading(M2, '2026-01-01', 50),
      makeReading(M2, '2026-01-02', 75),
    ]);
  });

  after(() => clearReadings());

  it('returns daily buckets with count aggregation', () => {
    const result = aggregateReadings(getReadings(), {
      startDate: '2026-01-01',
      endDate: '2026-01-02',
      granularity: 'day',
      aggregationType: 'count',
    });
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].key, '2026-01-01');
    // 2 readings from M1 + 1 from M2 on Jan 1
    assert.strictEqual(result[0].count, 3);
    assert.strictEqual(result[1].key, '2026-01-02');
    assert.strictEqual(result[1].count, 2);
  });

  it('returns daily buckets with sum aggregation', () => {
    const result = aggregateReadings(getReadings(), {
      startDate: '2026-01-01',
      endDate: '2026-01-02',
      granularity: 'day',
      aggregationType: 'sum',
    });
    // Jan 1: 100 + 200 + 50 = 350
    assert.strictEqual(result[0].value, 350);
    // Jan 2: 150 + 75 = 225
    assert.strictEqual(result[1].value, 225);
  });

  it('returns daily buckets with avg aggregation', () => {
    const result = aggregateReadings(getReadings(), {
      startDate: '2026-01-01',
      endDate: '2026-01-02',
      granularity: 'day',
      aggregationType: 'avg',
    });
    // Jan 1: (100 + 200 + 50) / 3 = 116.67
    assert.strictEqual(Math.round(result[0].value), 117);
    // Jan 2: (150 + 75) / 2 = 112.5
    assert.strictEqual(Math.round(result[1].value), 113);
  });

  it('returns daily buckets with min aggregation', () => {
    const result = aggregateReadings(getReadings(), {
      startDate: '2026-01-01',
      endDate: '2026-01-02',
      granularity: 'day',
      aggregationType: 'min',
    });
    assert.strictEqual(result[0].value, 50);
    assert.strictEqual(result[1].value, 75);
  });

  it('returns daily buckets with max aggregation', () => {
    const result = aggregateReadings(getReadings(), {
      startDate: '2026-01-01',
      endDate: '2026-01-02',
      granularity: 'day',
      aggregationType: 'max',
    });
    assert.strictEqual(result[0].value, 200);
    assert.strictEqual(result[1].value, 150);
  });

  it('filters by specific meters', () => {
    const result = aggregateReadings(getReadings(), {
      startDate: '2026-01-01',
      endDate: '2026-01-02',
      granularity: 'day',
      aggregationType: 'sum',
      meters: [M1],
    });
    // Only M1 readings: Jan 1 = 300, Jan 2 = 150
    assert.strictEqual(result[0].value, 300);
    assert.strictEqual(result[1].value, 150);
  });

  it('returns empty buckets when no readings match', () => {
    const result = aggregateReadings(getReadings(), {
      startDate: '2025-01-01',
      endDate: '2025-01-03',
      granularity: 'day',
      aggregationType: 'count',
    });
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].value, 0); // count returns 0 for empty
  });

  it('returns monthly buckets', () => {
    const result = aggregateReadings(getReadings(), {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      granularity: 'month',
      aggregationType: 'sum',
    });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].key, '2026-01');
    // Total: 100 + 200 + 150 + 50 + 75 = 575
    assert.strictEqual(result[0].value, 575);
  });
});

// ---------------------------------------------------------------------------
// fleetSummary
// ---------------------------------------------------------------------------

describe('fleetSummary', () => {
  before(() => {
    clearReadings();
    addReadings([
      makeReading(M1, '2026-01-01', 100),
      makeReading(M1, '2026-01-02', 200),
      makeReading(M2, '2026-01-01', 50),
      makeReading(M2, '2026-01-02', 150),
    ]);
  });

  after(() => clearReadings());

  it('returns fleet-wide summary with per-meter breakdown', () => {
    const result = fleetSummary(getReadings(), { aggregationType: 'sum' });
    assert.strictEqual(result.fleet.totalReadings, 4);
    assert.strictEqual(result.fleet.totalMeters, 2);
    assert.strictEqual(result.fleet.value, 500); // 100 + 200 + 50 + 150
    assert.strictEqual(result.meters.length, 2);
  });

  it('identifies top and bottom performers', () => {
    const result = fleetSummary(getReadings(), { aggregationType: 'sum' });
    assert.strictEqual(result.topPerformer.meterId, M1);
    assert.strictEqual(result.bottomPerformer.meterId, M2);
  });
});

// ---------------------------------------------------------------------------
// comparePeriods
// ---------------------------------------------------------------------------

describe('comparePeriods', () => {
  it('computes delta and percentage change', () => {
    const current = [{ key: '2026-01-01', value: 100, count: 1 }];
    const previous = [{ key: '2025-12-01', value: 80, count: 1 }];
    const result = comparePeriods(current, previous);
    assert.strictEqual(result.comparison.delta, 20);
    assert.strictEqual(result.comparison.percentageChange, 25);
  });

  it('handles zero previous value', () => {
    const current = [{ key: '2026-01-01', value: 100, count: 1 }];
    const previous = [{ key: '2025-12-01', value: 0, count: 1 }];
    const result = comparePeriods(current, previous);
    assert.strictEqual(result.comparison.delta, 100);
    assert.strictEqual(result.comparison.percentageChange, null);
  });

  it('handles empty data', () => {
    const result = comparePeriods([], []);
    assert.strictEqual(result.comparison.delta, 0);
    assert.strictEqual(result.comparison.percentageChange, null);
  });
});

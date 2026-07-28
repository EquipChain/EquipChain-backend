const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

const app = require('../index');
const { clearReadings, addReadings } = require('../src/services/aggregator');

const server = app.listen(0);
const BASE = () => `http://localhost:${server.address().port}`;

after(() => {
  clearReadings();
  server.close();
});

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
// Setup
// ---------------------------------------------------------------------------

before(() => {
  clearReadings();
  addReadings([
    makeReading(M1, '2026-01-01', 100),
    makeReading(M1, '2026-01-01', 200),
    makeReading(M1, '2026-01-02', 150),
    makeReading(M1, '2026-01-03', 300),
    makeReading(M2, '2026-01-01', 50),
    makeReading(M2, '2026-01-02', 75),
    makeReading(M2, '2026-01-03', 125),
  ]);
});

// ---------------------------------------------------------------------------
// GET /api/analytics/daily-summary
// ---------------------------------------------------------------------------

describe('GET /api/analytics/daily-summary', () => {
  it('returns daily aggregation for a date range', async () => {
    const res = await fetch(
      `${BASE()}/api/analytics/daily-summary?startDate=2026-01-01&endDate=2026-01-03`
    );
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.ok(body.data);
    assert.ok(body.meta);
    assert.strictEqual(body.meta.granularity, 'day');
    assert.strictEqual(body.data.length, 3);
    assert.strictEqual(body.data[0].key, '2026-01-01');
  });

  it('supports aggregationType=sum', async () => {
    const res = await fetch(
      `${BASE()}/api/analytics/daily-summary?startDate=2026-01-01&endDate=2026-01-01&aggregationType=sum`
    );
    const body = await res.json();
    // M1: 100 + 200 = 300, M2: 50 => total = 350
    assert.strictEqual(body.data[0].value, 350);
  });

  it('supports aggregationType=count', async () => {
    const res = await fetch(
      `${BASE()}/api/analytics/daily-summary?startDate=2026-01-01&endDate=2026-01-01&aggregationType=count`
    );
    const body = await res.json();
    assert.strictEqual(body.data[0].value, 3); // 2 M1 + 1 M2
  });

  it('filters by meterIds', async () => {
    const res = await fetch(
      `${BASE()}/api/analytics/daily-summary?startDate=2026-01-01&endDate=2026-01-03&meterIds=${M1}`
    );
    const body = await res.json();
    // With only M1 and default aggregationType=avg:
    // Jan 1: (100+200)/2 = 150
    assert.strictEqual(body.data[0].value, 150);
    // Jan 2: 150
    assert.strictEqual(body.data[1].value, 150);
  });

  it('returns 400 for invalid date', async () => {
    const res = await fetch(
      `${BASE()}/api/analytics/daily-summary?startDate=invalid&endDate=2026-01-01`
    );
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error, 'Validation failed');
  });

  it('supports compareWith=previous_period', async () => {
    // Add readings in previous period for the comparison
    addReadings([makeReading(M1, '2025-12-15', 100)]);
    const res = await fetch(
      `${BASE()}/api/analytics/daily-summary?startDate=2026-01-01&endDate=2026-01-15&aggregationType=sum&compareWith=previous_period`
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.comparison);
    assert.ok(body.comparison.current);
    assert.ok(body.comparison.previous);
    assert.ok(body.comparison.comparison.delta !== undefined);
    assert.ok(body.comparison.comparison.percentageChange !== undefined);
  });
});

// ---------------------------------------------------------------------------
// GET /api/analytics/monthly-summary
// ---------------------------------------------------------------------------

describe('GET /api/analytics/monthly-summary', () => {
  it('returns monthly aggregation for a date range', async () => {
    const res = await fetch(
      `${BASE()}/api/analytics/monthly-summary?startDate=2026-01-01&endDate=2026-01-31`
    );
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.meta.granularity, 'month');
    assert.ok(body.data.length >= 1);
    assert.strictEqual(body.data[0].key, '2026-01');
  });
});

// ---------------------------------------------------------------------------
// GET /api/analytics/custom-range
// ---------------------------------------------------------------------------

describe('GET /api/analytics/custom-range', () => {
  it('returns hourly aggregation', async () => {
    const res = await fetch(
      `${BASE()}/api/analytics/custom-range?startDate=2026-01-01&endDate=2026-01-01&granularity=hour`
    );
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.meta.granularity, 'hour');
    assert.ok(body.data.length > 0);
  });

  it('returns weekly aggregation', async () => {
    const res = await fetch(
      `${BASE()}/api/analytics/custom-range?startDate=2026-01-01&endDate=2026-01-31&granularity=week`
    );
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.meta.granularity, 'week');
    assert.ok(body.data.length > 0);
  });

  it('returns 400 for invalid granularity', async () => {
    const res = await fetch(
      `${BASE()}/api/analytics/custom-range?startDate=2026-01-01&endDate=2026-01-01&granularity=invalid`
    );
    assert.strictEqual(res.status, 400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/analytics/fleet-summary
// ---------------------------------------------------------------------------

describe('GET /api/analytics/fleet-summary', () => {
  it('returns fleet-wide summary', async () => {
    const res = await fetch(`${BASE()}/api/analytics/fleet-summary`);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.ok(body.fleet);
    assert.ok(body.meters);
    assert.ok(body.fleet.totalReadings > 0);
    assert.ok(body.fleet.totalMeters > 0);
  });

  it('supports date filtering', async () => {
    const res = await fetch(
      `${BASE()}/api/analytics/fleet-summary?startDate=2026-01-01&endDate=2026-01-01`
    );
    const body = await res.json();
    assert.strictEqual(body.fleet.totalReadings, 3); // 2 M1 + 1 M2
  });

  it('returns top and bottom performers', async () => {
    const res = await fetch(`${BASE()}/api/analytics/fleet-summary`);
    const body = await res.json();
    assert.ok(body.topPerformer);
    assert.ok(body.bottomPerformer);
    assert.ok(body.topPerformer.meterId);
    assert.ok(body.bottomPerformer.meterId);
  });
});

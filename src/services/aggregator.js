/**
 * Aggregation Service
 *
 * Provides in-memory data storage and aggregation logic for dashboard analytics.
 * Supports daily, monthly, custom-range, and fleet-wide summaries with multiple
 * aggregation types (count, sum, avg, min, max, p50, p95) and period comparison.
 *
 * For MVP, data is stored in-memory. The aggregation functions are designed to be
 * swappable with database aggregation queries in production.
 */

// ---------------------------------------------------------------------------
// In-Memory Data Store
// ---------------------------------------------------------------------------

/** @type {Array<{ id: string, meterId: string, timestamp: number, value: number, unit: string, createdAt: string }>} */
let readings = [];

let nextId = 1;

/**
 * Generate a simple incrementing ID.
 * @returns {string}
 */
function generateId() {
  return String(nextId++);
}

/**
 * Add one or more readings to the in-memory store.
 * @param {Array|Object} data - Single reading or array of readings
 * @returns {Array} The stored reading(s)
 */
function addReadings(data) {
  const items = Array.isArray(data) ? data : [data];
  const stored = items.map((item) => ({
    id: generateId(),
    meterId: item.meterId,
    timestamp: typeof item.timestamp === 'number' ? item.timestamp : new Date(item.timestamp).getTime(),
    value: Number(item.value),
    unit: item.unit || 'kWh',
    createdAt: item.createdAt || new Date().toISOString(),
  }));
  readings.push(...stored);
  return stored.length === 1 ? stored[0] : stored;
}

/**
 * Get readings, optionally filtered by meter IDs and/or date range.
 * @param {{ meterIds?: string[], startDate?: string|number, endDate?: string|number }} [filters]
 * @returns {Array}
 */
function getReadings(filters = {}) {
  let result = [...readings];

  if (filters.meterIds && filters.meterIds.length > 0) {
    result = result.filter((r) => filters.meterIds.includes(r.meterId));
  }

  if (filters.startDate) {
    const start = typeof filters.startDate === 'number' ? filters.startDate : new Date(filters.startDate).getTime();
    result = result.filter((r) => r.timestamp >= start);
  }

  if (filters.endDate) {
    // Set to end of the day to include readings on the end date
    const endDate = new Date(filters.endDate);
    endDate.setUTCHours(23, 59, 59, 999);
    const end = endDate.getTime();
    result = result.filter((r) => r.timestamp <= end);
  }

  return result;
}

/**
 * Clear all readings (useful for testing).
 */
function clearReadings() {
  readings = [];
  nextId = 1;
}

/**
 * Get the total number of stored readings.
 * @returns {number}
 */
function readingCount() {
  return readings.length;
}

// ---------------------------------------------------------------------------
// Aggregation Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a percentile value from a sorted array of numbers.
 * Uses linear interpolation between adjacent values.
 *
 * @param {number[]} sortedValues - Must be sorted ascending
 * @param {number} percentile - 0–100
 * @returns {number}
 */
function percentile(sortedValues, percentile) {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return sortedValues[lower];

  const fraction = index - lower;
  return sortedValues[lower] + fraction * (sortedValues[upper] - sortedValues[lower]);
}

/**
 * Apply an aggregation function to an array of numeric values.
 *
 * @param {number[]} values
 * @param {'count'|'sum'|'avg'|'min'|'max'|'p50'|'p95'} type
 * @returns {number}
 */
function aggregateValues(values, type) {
  if (values.length === 0) {
    return type === 'count' ? 0 : null;
  }

  switch (type) {
    case 'count':
      return values.length;
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'avg': {
      const sum = values.reduce((a, b) => a + b, 0);
      return sum / values.length;
    }
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'p50': {
      const sorted = [...values].sort((a, b) => a - b);
      return percentile(sorted, 50);
    }
    case 'p95': {
      const sorted = [...values].sort((a, b) => a - b);
      return percentile(sorted, 95);
    }
    default:
      throw new Error(`Unknown aggregation type: ${type}`);
  }
}

// ---------------------------------------------------------------------------
// Time Bucket Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the bucket key for a given timestamp based on granularity.
 * Returns a string key that can be used for grouping.
 *
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @param {'hour'|'day'|'week'|'month'} granularity
 * @returns {string} ISO-like key, e.g. "2026-01-15" for day granularity
 */
function getBucketKey(timestamp, granularity) {
  const date = new Date(timestamp);

  switch (granularity) {
    case 'hour': {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      const h = String(date.getUTCHours()).padStart(2, '0');
      return `${y}-${m}-${d}T${h}:00:00Z`;
    }
    case 'day': {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    case 'week': {
      const dayOfWeek = date.getUTCDay();
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(date);
      monday.setUTCDate(date.getUTCDate() - diff);
      const y = monday.getUTCFullYear();
      const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
      const d = String(monday.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    case 'month': {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      return `${y}-${m}`;
    }
    default:
      throw new Error(`Unknown granularity: ${granularity}`);
  }
}

/**
 * Generate all bucket keys between startDate and endDate for a given granularity.
 * Used to fill gaps so responses include all expected time slots.
 * endDate is treated inclusively (end of day).
 *
 * @param {string} startDate - ISO date string
 * @param {string} endDate - ISO date string
 * @param {'hour'|'day'|'week'|'month'} granularity
 * @returns {string[]} Sorted array of bucket keys
 */
function generateBucketKeys(startDate, endDate, granularity) {
  const keys = [];
  const endOfDay = new Date(endDate);
  endOfDay.setUTCHours(23, 59, 59, 999);
  const end = endOfDay.getTime();

  const current = new Date(startDate);

  while (current.getTime() <= end) {
    keys.push(getBucketKey(current.getTime(), granularity));

    switch (granularity) {
      case 'hour':
        current.setUTCHours(current.getUTCHours() + 1);
        break;
      case 'day':
        current.setUTCDate(current.getUTCDate() + 1);
        break;
      case 'week':
        current.setUTCDate(current.getUTCDate() + 7);
        break;
      case 'month':
        current.setUTCMonth(current.getUTCMonth() + 1);
        break;
    }
  }

  return keys;
}

// ---------------------------------------------------------------------------
// Core Aggregation Functions
// ---------------------------------------------------------------------------

/**
 * Aggregate readings into time-based buckets.
 *
 * @param {Array} sourceReadings - Array of reading objects with { timestamp, value, meterId }
 * @param {Object} options
 * @param {string} options.startDate - ISO date string for range start
 * @param {string} options.endDate - ISO date string for range end
 * @param {'hour'|'day'|'week'|'month'} options.granularity - Time bucket size
 * @param {string[]} [options.meters] - Optional meter ID filter
 * @param {'count'|'sum'|'avg'|'min'|'max'|'p50'|'p95'} options.aggregationType
 * @param {boolean} [options.fillGaps=true] - Whether to fill empty buckets
 * @returns {Array<{ key: string, value: number|null, count: number }>}
 */
function aggregateReadings(sourceReadings, options) {
  const {
    startDate,
    endDate,
    granularity = 'day',
    meters,
    aggregationType = 'avg',
    fillGaps = true,
  } = options || {};

  // Filter by date range and meters
  let filtered = [...sourceReadings];

  if (startDate) {
    const start = new Date(startDate).getTime();
    filtered = filtered.filter((r) => r.timestamp >= start);
  }

  if (endDate) {
    const endOfDay = new Date(endDate);
    endOfDay.setUTCHours(23, 59, 59, 999);
    filtered = filtered.filter((r) => r.timestamp <= endOfDay.getTime());
  }

  if (meters && meters.length > 0) {
    filtered = filtered.filter((r) => meters.includes(r.meterId));
  }

  // Group readings by time bucket
  const bucketMap = new Map();

  for (const reading of filtered) {
    const key = getBucketKey(reading.timestamp, granularity);
    if (!bucketMap.has(key)) {
      bucketMap.set(key, []);
    }
    bucketMap.get(key).push(reading.value);
  }

  // Aggregate each bucket
  const buckets = [];
  for (const [key, values] of bucketMap) {
    buckets.push({
      key,
      value: aggregateValues(values, aggregationType),
      count: values.length,
    });
  }

  // Fill gaps with empty buckets
  if (fillGaps && startDate && endDate) {
    const bucketKeys = new Set(buckets.map((b) => b.key));
    const allKeys = generateBucketKeys(startDate, endDate, granularity);

    for (const key of allKeys) {
      if (!bucketKeys.has(key)) {
        buckets.push({
          key,
          value: aggregationType === 'count' ? 0 : null,
          count: 0,
        });
      }
    }

    buckets.sort((a, b) => a.key.localeCompare(b.key));
  }

  return buckets;
}

/**
 * Compute a fleet-wide summary across all meters.
 *
 * @param {Array} sourceReadings
 * @param {Object} [options]
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @param {'count'|'sum'|'avg'|'min'|'max'|'p50'|'p95'} [options.aggregationType='avg']
 * @returns {Object}
 */
function fleetSummary(sourceReadings, options = {}) {
  const { startDate, endDate, aggregationType = 'avg' } = options || {};

  let filtered = [...sourceReadings];

  if (startDate) {
    const start = new Date(startDate).getTime();
    filtered = filtered.filter((r) => r.timestamp >= start);
  }

  if (endDate) {
    const endOfDay = new Date(endDate);
    endOfDay.setUTCHours(23, 59, 59, 999);
    filtered = filtered.filter((r) => r.timestamp <= endOfDay.getTime());
  }

  // Group by meter
  const meterGroups = new Map();
  for (const reading of filtered) {
    if (!meterGroups.has(reading.meterId)) {
      meterGroups.set(reading.meterId, []);
    }
    meterGroups.get(reading.meterId).push(reading.value);
  }

  // Per-meter aggregates
  const meters = [];
  for (const [meterId, values] of meterGroups) {
    meters.push({
      meterId,
      value: aggregateValues(values, aggregationType),
      readings: values.length,
    });
  }

  // Fleet-wide aggregate
  const allValues = filtered.map((r) => r.value);
  const fleetValue = allValues.length > 0 ? aggregateValues(allValues, aggregationType) : null;

  // Top and bottom performers
  const sortedByValue = [...meters].sort((a, b) => b.value - a.value);
  const topPerformer = sortedByValue.length > 0 ? sortedByValue[0] : null;
  const bottomPerformer = sortedByValue.length > 0 ? sortedByValue[sortedByValue.length - 1] : null;

  return {
    fleet: {
      totalReadings: filtered.length,
      totalMeters: meterGroups.size,
      value: fleetValue,
      aggregationType,
    },
    meters,
    topPerformer,
    bottomPerformer,
  };
}

/**
 * Compare two sets of aggregated data and compute deltas and percentages.
 *
 * @param {Array} currentData - Array of { key, value, count } objects
 * @param {Array} previousData - Array of { key, value, count } objects
 * @returns {{ current: Array, previous: Array, comparison: { delta: number|null, percentageChange: number|null } }}
 */
function comparePeriods(currentData, previousData) {
  const currentSum = currentData.reduce((sum, item) => sum + (item.value || 0), 0);
  const previousSum = previousData.reduce((sum, item) => sum + (item.value || 0), 0);

  const delta = currentSum - previousSum;
  const percentageChange = previousSum !== 0 ? ((delta / Math.abs(previousSum)) * 100) : null;

  return {
    current: currentData,
    previous: previousData,
    comparison: {
      delta,
      percentageChange: percentageChange !== null ? Math.round(percentageChange * 100) / 100 : null,
    },
  };
}

module.exports = {
  // Data store
  addReadings,
  getReadings,
  clearReadings,
  readingCount,
  // Aggregation
  aggregateReadings,
  fleetSummary,
  comparePeriods,
  aggregateValues,
  percentile,
  getBucketKey,
  generateBucketKeys,
};

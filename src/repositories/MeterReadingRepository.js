/**
 * MeterReadingRepository — Reading Data Points Store
 *
 * Manages meter reading data points. This repository is designed to be used
 * by the analytics aggregation service for computing daily, monthly, and
 * custom-range summaries.
 *
 * Domain-specific methods:
 *   - findByMeterId(meterId, dateRange)
 *   - findByDateRange(startDate, endDate)
 *   - getReadings(filters) — flexible filtering for the aggregator
 *   - addReadings(data) — batch insert with data generation
 *   - clearReadings() — clear all readings (for testing)
 *   - readingCount() — get total count
 */

const BaseRepository = require('./BaseRepository');

class MeterReadingRepository extends BaseRepository {
  constructor() {
    super({ entityName: 'meterReading' });
    this._allowedFilters = ['meterId'];
    this._sortableFields = ['meterId', 'timestamp', 'value', 'createdAt'];
    this._searchableFields = ['meterId'];
    this._defaultSort = { field: 'timestamp', order: 'desc' };
  }

  /**
   * Find readings by meter ID within an optional date range.
   * @param {string} meterId
   * @param {{ startDate?: string|number, endDate?: string|number }} [dateRange]
   * @returns {Promise<Array>}
   */
  async findByMeterId(meterId, dateRange = {}) {
    let results = [...this._store.values()].filter((r) => r.meterId === meterId);

    if (dateRange.startDate) {
      const start = typeof dateRange.startDate === 'number'
        ? dateRange.startDate
        : new Date(dateRange.startDate).getTime();
      results = results.filter((r) => r.timestamp >= start);
    }

    if (dateRange.endDate) {
      const endDate = new Date(dateRange.endDate);
      endDate.setUTCHours(23, 59, 59, 999);
      results = results.filter((r) => r.timestamp <= endDate.getTime());
    }

    return results.map((r) => ({ ...r }));
  }

  /**
   * Find all readings within a date range.
   * @param {string|number} startDate
   * @param {string|number} endDate
   * @returns {Promise<Array>}
   */
  async findByDateRange(startDate, endDate) {
    const start = typeof startDate === 'number' ? startDate : new Date(startDate).getTime();
    const endOfDay = new Date(endDate);
    endOfDay.setUTCHours(23, 59, 59, 999);
    const end = endOfDay.getTime();

    return [...this._store.values()]
      .filter((r) => r.timestamp >= start && r.timestamp <= end)
      .map((r) => ({ ...r }));
  }

  /**
   * Get readings with flexible filtering (compatible with aggregator API).
   * @param {{ meterIds?: string[], startDate?: string|number, endDate?: string|number }} [filters]
   * @returns {Promise<Array>}
   */
  async getReadings(filters = {}) {
    let result = [...this._store.values()];

    if (filters.meterIds && filters.meterIds.length > 0) {
      result = result.filter((r) => filters.meterIds.includes(r.meterId));
    }

    if (filters.startDate) {
      const start = typeof filters.startDate === 'number'
        ? filters.startDate
        : new Date(filters.startDate).getTime();
      result = result.filter((r) => r.timestamp >= start);
    }

    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setUTCHours(23, 59, 59, 999);
      result = result.filter((r) => r.timestamp <= endDate.getTime());
    }

    return result.map((r) => ({ ...r }));
  }

  /**
   * Add multiple readings at once (batch insert).
   * @param {Array|Object} data
   * @returns {Promise<Array|Object>}
   */
  async addReadings(data) {
    const items = Array.isArray(data) ? data : [data];
    const stored = [];
    for (const item of items) {
      const reading = await this.create({
        meterId: item.meterId,
        timestamp: typeof item.timestamp === 'number' ? item.timestamp : new Date(item.timestamp).getTime(),
        value: Number(item.value),
        unit: item.unit || 'kWh',
      });
      stored.push(reading);
    }
    return stored.length === 1 ? stored[0] : stored;
  }

  /**
   * Clear all readings.
   */
  async clearReadings() {
    await this.clear();
  }

  /**
   * Get the total count of readings.
   * @returns {Promise<number>}
   */
  async readingCount() {
    return this._store.size;
  }
}

module.exports = MeterReadingRepository;

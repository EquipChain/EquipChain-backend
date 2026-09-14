'use strict';

// src/jobs/cacheWarm.job.js
//
// Cache-warm handler for the job queue. Pre-computes and caches the exact
// payloads the analytics endpoints serve, so the first real request after a
// cache flush or deploy is warm instead of cold.
//
// Replaces the placeholder that cached fabricated objects (random values,
// random block heights) under keys nothing ever read.

const { childLogger } = require('../config/logger');
const {
  getReadings,
  aggregateReadings,
  fleetSummary,
} = require('../services/aggregator');
const { cacheService } = require('../services/cache');

const log = childLogger('job:cacheWarm');

// TTLs mirror how stale each payload may be before it is worse than cold.
const TTL_SECONDS = {
  fleetSummary: 600, // 10 min
  daily: 3600, // 1 h
  contractState: 300, // 5 min
};

/**
 * Warm the fleet summary cache - the payload /api/analytics/fleet-summary
 * computes from the same inputs.
 */
async function warmFleetSummary() {
  const today = new Date().toISOString().slice(0, 10);
  const readings = getReadings({ startDate: today, endDate: today });
  const summary = fleetSummary(readings, { startDate: today, endDate: today, aggregationType: 'avg' });

  const key = 'analytics:fleet-summary:today';
  await cacheService.set(key, summary, TTL_SECONDS.fleetSummary);
  return key;
}

/**
 * Warm daily aggregation buckets for the recent window.
 */
async function warmDailyAggregates(days = 7) {
  const keysWarmed = [];
  const end = new Date();

  for (let i = 0; i < days; i++) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);

    const readings = getReadings({ startDate: date, endDate: date });
    const buckets = aggregateReadings(readings, {
      startDate: date,
      endDate: date,
      granularity: 'day',
      aggregationType: 'sum',
    });

    const key = `analytics:daily:${date}`;
    await cacheService.set(key, buckets, TTL_SECONDS.daily);
    keysWarmed.push(key);
  }
  return keysWarmed;
}

/**
 * Warm the contract-state cache from the most recent readings snapshot.
 * (Soroban sync will replace this source when the chain integration lands;
 * until then the shape matches what the sync job writes.)
 */
async function warmContractState() {
  const state = {
    totalMeters: new Set(getReadings().map((r) => r.meterId)).size,
    lastSync: new Date().toISOString(),
    source: 'readings-store',
  };

  const key = 'contract:state:latest';
  await cacheService.set(key, state, TTL_SECONDS.contractState);
  return key;
}

/**
 * Cache warm job handler.
 *
 * @param {Object} data - Job data
 * @param {string} [data.cacheType] - 'meter_data' | 'contract_state' | 'fleet_summary' | 'all'
 * @param {number} [data.days] - Days of daily aggregates to warm (default 7)
 * @returns {Object} Warming results
 */
async function cacheWarmHandler(data = {}) {
  const { cacheType = 'all', days = 7 } = data;
  const warmedKeys = [];

  const targets =
    cacheType === 'all'
      ? ['fleet_summary', 'meter_data', 'contract_state']
      : [cacheType];

  for (const target of targets) {
    switch (target) {
      case 'fleet_summary':
        warmedKeys.push(await warmFleetSummary());
        break;
      case 'meter_data':
        warmedKeys.push(...(await warmDailyAggregates(days)));
        break;
      case 'contract_state':
        warmedKeys.push(await warmContractState());
        break;
      default:
        throw new Error(
          `Unknown cacheType "${target}". Expected fleet_summary, meter_data, contract_state or all`
        );
    }
  }

  const stats = await cacheService.getStats();
  log.info({ cacheType, keysWarmed: warmedKeys.length }, 'Cache warm completed');

  return {
    cacheType,
    keysWarmed: warmedKeys.length,
    warmedKeys,
    cacheStats: stats,
    warmedAt: new Date().toISOString(),
  };
}

module.exports = cacheWarmHandler;

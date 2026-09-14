'use strict';

// src/jobs/reports.job.js
//
// Report generation handler for the job queue. Computes real per-meter
// aggregations from the readings store for the requested day/month and
// caches the result so analytics endpoints can serve it warm.
//
// Replaces the placeholder that slept 1.5s and returned random counts -
// reports that contain random numbers are worse than no reports.

const { childLogger } = require('../config/logger');
const {
  getReadings,
  aggregateReadings,
  fleetSummary,
} = require('../services/aggregator');
const { cacheService } = require('../services/cache');

const log = childLogger('job:reports');

const REPORT_CACHE_TTL_SECONDS = 6 * 60 * 60; // keep generated reports for 6h

/**
 * Build the report body for one period.
 * @param {'daily'|'monthly'} type
 * @param {string} date - YYYY-MM-DD
 */
function buildReport(type, date) {
  const granularity = type === 'monthly' ? 'month' : 'day';

  const readings = getReadings({ startDate: date, endDate: date });
  const buckets = aggregateReadings(readings, {
    startDate: date,
    endDate: date,
    granularity,
    aggregationType: 'sum',
  });
  const summary = fleetSummary(readings, { startDate: date, endDate: date, aggregationType: 'sum' });

  return {
    type,
    date,
    granularity,
    generatedAt: new Date().toISOString(),
    totalReadings: readings.length,
    buckets,
    summary,
  };
}

/**
 * Reports job handler.
 *
 * @param {Object} data - Job data
 * @param {string} data.type - Report type ('daily' or 'monthly')
 * @param {string} data.date - Date for the report (YYYY-MM-DD)
 * @returns {Object} The generated report (also written to cache)
 */
async function reportsHandler(data) {
  const { type = 'daily', date = new Date().toISOString().slice(0, 10) } = data || {};

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid report date "${date}"; expected YYYY-MM-DD`);
  }
  if (!['daily', 'monthly'].includes(type)) {
    throw new Error(`Invalid report type "${type}"; expected 'daily' or 'monthly'`);
  }

  log.info({ type, date }, 'Generating report');

  const report = buildReport(type, date);

  const cacheKey = `reports:${type}:${date}`;
  try {
    await cacheService.set(cacheKey, report, REPORT_CACHE_TTL_SECONDS);
  } catch (err) {
    // Cache write is best-effort; the report is still returned to the caller.
    log.warn({ cacheKey, error: err.message }, 'Could not cache report');
  }

  log.info(
    { type, date, totalReadings: report.totalReadings, meters: report.summary.meters.length },
    'Report generated'
  );

  return report;
}

module.exports = reportsHandler;

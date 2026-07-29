const { Router } = require('express');
const { childLogger } = require('../config/logger');
const { getReadings, aggregateReadings, fleetSummary, comparePeriods } = require('../services/aggregator');
const {
  dailySummarySchema,
  monthlySummarySchema,
  customRangeSchema,
  fleetSummarySchema,
} = require('../schemas/analytics.schema');

const router = Router();
const log = childLogger('analytics');

/**
 * Parse query params using a Zod schema and return { parsed, errors }.
 */
function parseQuery(schema, query) {
  const result = schema.safeParse(query);
  if (!result.success) {
    return {
      errors: result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }
  return { parsed: result.data };
}

/**
 * Compute the previous period dates based on comparison mode.
 *
 * @param {string} startDate - ISO date string
 * @param {string} endDate - ISO date string
 * @param {'previous_period'|'year_over_year'} compareWith
 * @returns {{ startDate: string, endDate: string }}
 */
function getPreviousPeriodDates(startDate, endDate, compareWith) {
  const currentStart = new Date(startDate);
  const currentEnd = new Date(endDate);

  if (compareWith === 'year_over_year') {
    // Same dates, one year earlier
    const prevStart = new Date(currentStart);
    prevStart.setUTCFullYear(prevStart.getUTCFullYear() - 1);
    const prevEnd = new Date(currentEnd);
    prevEnd.setUTCFullYear(prevEnd.getUTCFullYear() - 1);
    return {
      startDate: prevStart.toISOString().split('T')[0],
      endDate: prevEnd.toISOString().split('T')[0],
    };
  }

  // previous_period: mirror the duration before the current start date
  const periodDuration = currentEnd.getTime() - currentStart.getTime();
  const prevEnd = new Date(currentStart.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - periodDuration);
  return {
    startDate: prevStart.toISOString().split('T')[0],
    endDate: prevEnd.toISOString().split('T')[0],
  };
}

/**
 * Build and send aggregated response with optional period comparison.
 */
function sendAggregatedResponse(req, res, schema, granularity) {
  const { parsed, errors } = parseQuery(schema, req.query);
  if (errors) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const { startDate, endDate, meterIds, aggregationType, timezone, compareWith } = parsed;

  const readings = getReadings({
    meterIds: meterIds || undefined,
    startDate,
    endDate,
  });

  const aggregated = aggregateReadings(readings, {
    startDate,
    endDate,
    granularity,
    meters: meterIds || undefined,
    aggregationType,
  });

  const response = {
    data: aggregated,
    meta: {
      startDate,
      endDate,
      granularity,
      aggregationType,
      timezone,
      totalReadings: readings.length,
    },
  };

  // Handle period comparison
  if (compareWith) {
    const prevDates = getPreviousPeriodDates(startDate, endDate, compareWith);
    const previousReadings = getReadings({
      meterIds: meterIds || undefined,
      startDate: prevDates.startDate,
      endDate: prevDates.endDate,
    });

    const previousAggregated = aggregateReadings(previousReadings, {
      startDate: prevDates.startDate,
      endDate: prevDates.endDate,
      granularity,
      meters: meterIds || undefined,
      aggregationType,
    });

    response.comparison = comparePeriods(aggregated, previousAggregated);
    response.comparison.mode = compareWith;
  }

  res.json(response);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/analytics/daily-summary
 *
 * Returns daily aggregated readings within a date range.
 * Query params: startDate, endDate, meterIds (optional), timezone (default UTC),
 *               aggregationType (default avg), compareWith (optional)
 */
router.get('/daily-summary', (req, res, next) => {
  try {
    sendAggregatedResponse(req, res, dailySummarySchema, 'day');
  } catch (err) {
    log.error({ err }, 'daily-summary error');
    next(err);
  }
});

/**
 * GET /api/analytics/monthly-summary
 *
 * Returns monthly aggregated readings within a date range.
 * Query params: same as daily-summary
 */
router.get('/monthly-summary', (req, res, next) => {
  try {
    sendAggregatedResponse(req, res, monthlySummarySchema, 'month');
  } catch (err) {
    log.error({ err }, 'monthly-summary error');
    next(err);
  }
});

/**
 * GET /api/analytics/custom-range
 *
 * Returns aggregated readings with configurable granularity.
 * Query params: startDate, endDate, granularity (hour|day|week|month),
 *               meterIds (optional), timezone (default UTC), aggregationType (default avg)
 */
router.get('/custom-range', (req, res, next) => {
  try {
    const { parsed, errors } = parseQuery(customRangeSchema, req.query);
    if (errors) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    const { startDate, endDate, granularity, meterIds, aggregationType, timezone } = parsed;

    const readings = getReadings({
      meterIds: meterIds || undefined,
      startDate,
      endDate,
    });

    const aggregated = aggregateReadings(readings, {
      startDate,
      endDate,
      granularity,
      meters: meterIds || undefined,
      aggregationType,
    });

    res.json({
      data: aggregated,
      meta: {
        startDate,
        endDate,
        granularity,
        aggregationType,
        timezone,
        totalReadings: readings.length,
      },
    });
  } catch (err) {
    log.error({ err }, 'custom-range error');
    next(err);
  }
});

/**
 * GET /api/analytics/fleet-summary
 *
 * Returns fleet-wide aggregated summary across all meters.
 * Query params: startDate (optional), endDate (optional), aggregationType (default avg)
 */
router.get('/fleet-summary', (req, res, next) => {
  try {
    const { parsed, errors } = parseQuery(fleetSummarySchema, req.query);
    if (errors) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    const { startDate, endDate, aggregationType } = parsed;

    const readings = getReadings({ startDate, endDate });
    const summary = fleetSummary(readings, { startDate, endDate, aggregationType });

    res.json(summary);
  } catch (err) {
    log.error({ err }, 'fleet-summary error');
    next(err);
  }
});

module.exports = router;

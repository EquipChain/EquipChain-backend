const { Router } = require('express');
const { childLogger } = require('../config/logger');
const { getReadings, aggregateReadings, fleetSummary, comparePeriods } = require('../services/aggregator');
const { validate } = require('../middleware/validate');
const {
  dailySummaryQuerySchema,
  monthlySummaryQuerySchema,
  customRangeQuerySchema,
  fleetSummaryQuerySchema,
} = require('../schemas/validation.schema');

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
 * @openapi
 * /api/analytics/daily-summary:
 *   get:
 *     summary: Daily aggregated meter readings
 *     description: Returns daily aggregated readings within a date range.
 *     tags: [Analytics]
 *     parameters:
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: meterIds
 *         schema: { type: array, items: { type: string } }
 *       - in: query
 *         name: aggregationType
 *         schema: { type: string, enum: [count, sum, avg, min, max, p50, p95] }
 *       - in: query
 *         name: compareWith
 *         schema: { type: string, enum: [previous_period, year_over_year] }
 *     responses:
 *       200: { description: Daily aggregation result }
 *       400: { description: Validation failed }
 */
router.get('/daily-summary', validate(dailySummaryQuerySchema), (req, res, next) => {
  try {
    sendAggregatedResponse(req, res, dailySummaryQuerySchema.query, 'day');
  } catch (err) {
    log.error({ err }, 'daily-summary error');
    next(err);
  }
});

/**
 * @openapi
 * /api/analytics/monthly-summary:
 *   get:
 *     summary: Monthly aggregated meter readings
 *     description: Returns monthly aggregated readings within a date range.
 *     tags: [Analytics]
 *     parameters:
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: meterIds
 *         schema: { type: array, items: { type: string } }
 *       - in: query
 *         name: aggregationType
 *         schema: { type: string, enum: [count, sum, avg, min, max, p50, p95] }
 *       - in: query
 *         name: compareWith
 *         schema: { type: string, enum: [previous_period, year_over_year] }
 *     responses:
 *       200: { description: Monthly aggregation result }
 *       400: { description: Validation failed }
 */
router.get('/monthly-summary', validate(monthlySummaryQuerySchema), (req, res, next) => {
  try {
    sendAggregatedResponse(req, res, monthlySummaryQuerySchema.query, 'month');
  } catch (err) {
    log.error({ err }, 'monthly-summary error');
    next(err);
  }
});

/**
 * @openapi
 * /api/analytics/custom-range:
 *   get:
 *     summary: Aggregated readings over a custom range
 *     description: Returns aggregated readings with configurable granularity.
 *     tags: [Analytics]
 *     parameters:
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: granularity
 *         required: true
 *         schema: { type: string, enum: [hour, day, week, month] }
 *       - in: query
 *         name: meterIds
 *         schema: { type: array, items: { type: string } }
 *       - in: query
 *         name: aggregationType
 *         schema: { type: string, enum: [count, sum, avg, min, max, p50, p95] }
 *     responses:
 *       200: { description: Custom-range aggregation result }
 *       400: { description: Validation failed }
 */
router.get('/custom-range', validate(customRangeQuerySchema), (req, res, next) => {
  try {
    const { parsed, errors } = parseQuery(customRangeQuerySchema.query, req.query);
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
 * @openapi
 * /api/analytics/fleet-summary:
 *   get:
 *     summary: Fleet-wide aggregated summary
 *     description: Returns fleet-wide aggregated summary across all meters.
 *     tags: [Analytics]
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: aggregationType
 *         schema: { type: string, enum: [count, sum, avg, min, max, p50, p95] }
 *     responses:
 *       200: { description: Fleet summary }
 *       400: { description: Validation failed }
 */
router.get('/fleet-summary', validate(fleetSummaryQuerySchema), (req, res, next) => {
  try {
    const { parsed, errors } = parseQuery(fleetSummaryQuerySchema.query, req.query);
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

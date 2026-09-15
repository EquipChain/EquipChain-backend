const { Router } = require('express');
const { childLogger } = require('../config/logger');
const { getReadings, aggregateReadings, fleetSummary, comparePeriods } = require('../services/aggregator');
const { paginateCursor } = require('../utils/pagination');
const { cacheService } = require('../services/cache');
const { readingCount } = require('../services/aggregator');
const { validate } = require('../middleware/validate');
const { requireApiKey } = require('../middleware/apiKeyAuth');
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
 * Aggregation results for full-day windows are cached (cache-aside, keyed on
 * the full query shape) because aggregations scan the entire readings store -
 * a dashboard polling every 5s would otherwise rescan tens of thousands of
 * readings per request. Cached entries are stamped with the store size when
 * written; a mismatch means readings arrived after the cache was written, so
 * the entry is stale by definition and recomputed. That gives correctness
 * (never serves aggregations missing fresh data) without any invalidation
 * wiring on ingest.
 */
async function sendAggregatedResponse(req, res, schema, granularity) {
  const { parsed, errors } = parseQuery(schema, req.query);
  if (errors) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const { startDate, endDate, meterIds, aggregationType, timezone, compareWith } = parsed;

  const cacheable = Boolean(startDate && endDate) && !compareWith;
  const cacheKey = cacheable
    ? `analytics:agg:${granularity}:${startDate}:${endDate}:${aggregationType}:${(meterIds || []).join(',')}`
    : null;

  if (cacheKey) {
    const cached = await cacheService.get(cacheKey);
    if (cached && cached._storeSize === readingCount()) {
      return res.json(cached.body);
    }
  }

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

  if (cacheKey) {
    response.meta.cachedAt = new Date().toISOString();
    // Best-effort fill; a cache outage must never fail the request.
    try {
      await cacheService.set(cacheKey, { _storeSize: readingCount(), body: response }, 300);
    } catch {
      // ignore
    }
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
router.get('/daily-summary', validate(dailySummarySchema), (req, res, next) => {
  sendAggregatedResponse(req, res, dailySummarySchema, 'day').catch((err) => {
    log.error({ err }, 'daily-summary error');
    next(err);
  });
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
router.get('/monthly-summary', validate(monthlySummarySchema), (req, res, next) => {
  sendAggregatedResponse(req, res, monthlySummarySchema, 'month').catch((err) => {
    log.error({ err }, 'monthly-summary error');
    next(err);
  });
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
router.get('/custom-range', validate(customRangeSchema), (req, res, next) => {
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
router.get('/fleet-summary', validate(fleetSummarySchema), async (req, res, next) => {
  try {
    const { parsed, errors } = parseQuery(fleetSummarySchema, req.query);
    if (errors) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    const { startDate, endDate, aggregationType } = parsed;

    // Cache-aside: the retention sweeper's hourly cadence and the cache-warm
    // job refresh analytics:fleet-summary:today, so today's unfiltered,
    // default-aggregation request (the dashboard's most common call) reads
    // warm. Every other shape computes and back-fills the cache.
    const isDefaultShape = !startDate && !endDate && aggregationType === 'avg';
    const cacheKey = 'analytics:fleet-summary:today';

    if (isDefaultShape) {
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }
    }

    const readings = getReadings({ startDate, endDate });
    const summary = fleetSummary(readings, { startDate, endDate, aggregationType });

    if (isDefaultShape) {
      // Best-effort back-fill; a cache outage must not fail the request.
      try {
        await cacheService.set(cacheKey, summary, 600);
      } catch {
        // ignore
      }
    }

    res.json(summary);
  } catch (err) {
    log.error({ err }, 'fleet-summary error');
    next(err);
  }
});

/**
 * @openapi
 * /api/analytics/readings:
 *   get:
 *     summary: Raw meter readings with keyset (cursor) pagination
 *     description: |
 *       Streams the raw readings list using cursor pagination. Offset paging
 *       degrades linearly with depth on an append-heavy dataset like meter
 *       readings and drifts as rows are inserted mid-scan; cursor anchoring
 *       gives constant-time pages regardless of depth.
 *     tags: [Analytics]
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: meterId
 *         schema: { type: string }
 *         description: Restrict to one meter
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 50 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *         description: Opaque cursor from a previous page
 *     responses:
 *       200: { description: One page of readings with pagination metadata }
 *       400: { description: Validation failed }
 *       401: { description: Missing or invalid API key }
 *       403: { description: API key lacks the read permission }
 */
router.get('/readings', requireApiKey({ permission: 'read' }), (req, res, next) => {
  try {
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;
    const meterId = typeof req.query.meterId === 'string' && req.query.meterId ? req.query.meterId : null;

    const filters = {};
    if (meterId) filters.meterIds = [meterId];
    const rows = getReadings(filters);

    // Canonical order (timestamp asc, then id) - stable and index-friendly.
    // The cursor utility enforces its own keyset ordering; we pass the sort
    // whitelist so a client-chosen sortBy stays validated.
    rows.sort((a, b) => a.timestamp - b.timestamp || String(a.id).localeCompare(String(b.id)));

    const page = paginateCursor(rows, {
      limit,
      cursor: req.query.cursor,
      before: req.query.before,
      sortBy: req.query.sortBy,
      sortOrder: req.query.sortOrder,
    }, {
      sortableFields: ['timestamp'],
      defaultSort: { field: 'timestamp', order: 'asc' },
    });

    res.json({
      data: page.data,
      pagination: page.pagination,
      meta: {
        meterId,
        totalInStore: readingCount(),
      },
    });
  } catch (err) {
    log.error({ err }, 'readings cursor error');
    next(err);
  }
});

module.exports = router;

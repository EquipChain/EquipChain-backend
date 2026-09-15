const express = require('express');
const router = express.Router();
const { handleExport } = require('../services/exporter');
const { childLogger } = require('../config/logger');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const {
  getReadings,
  getBucketKey,
  aggregateValues,
  readingCount,
} = require('../services/aggregator');
const { deviceStore } = require('../data/adminStore');
const {
  exportReadingsQuerySchema,
  exportAnalyticsParamsSchema,
  exportAnalyticsQuerySchema,
  exportMetersQuerySchema,
  exportSystemReportQuerySchema,
} = require('../schemas/validation.schema');

const log = childLogger('routes:exports');

// ─── Real data sources ───────────────────────────────────────────────────────
//
// Exports previously served hardcoded mock arrays: every "meter reading" a
// customer exported was one of three fabricated rows, the analytics summaries
// were constants, and the system report described meters that never existed.
// The real stores existed the whole time (the aggregator's readings store and
// the admin device registry) - exports just were not wired to them.
//
// There is deliberately no alert section data: the platform has no alert
// subsystem yet, so the report ships an honest empty array rather than a
// fabricated example alert.

/**
 * Export shape of a reading: timestamps serialize as ISO-8601 strings (the
 * store keeps epoch millis for arithmetic; exports are for humans and other
 * systems, both of which want ISO).
 */
function toExportReading(r) {
  return {
    id: r.id,
    meterId: r.meterId,
    timestamp: new Date(r.timestamp).toISOString(),
    value: r.value,
    unit: r.unit,
    createdAt: r.createdAt,
  };
}

/**
 * Real readings from the aggregator store, filtered by meter, date range,
 * and status. Status never matches real readings (they carry no status
 * field) - the filter is kept so the query contract stays stable and
 * simply selects nothing until readings gain a status concept.
 */
function getExportReadings({ meterIds, status, startDate, endDate } = {}) {
  const filters = {};
  if (meterIds && meterIds.length > 0) filters.meterIds = meterIds;
  if (startDate) filters.startDate = startDate;
  if (endDate) filters.endDate = endDate;

  let rows = getReadings(filters).map(toExportReading);
  if (status) {
    rows = rows.filter((r) => r.status === status);
  }
  return rows;
}

/**
 * Meter registry export from the admin device registry - the closest real
 * analogue to "the fleet". Registered devices are emitted honestly: fields
 * the registry does not track (status, last reading) are absent rather than
 * fabricated.
 */
function getExportMeters({ status, location } = {}) {
  let rows = deviceStore.list().map((d) => ({
    id: d.id,
    deviceId: d.deviceId,
    name: d.name,
    location: d.location || null,
    registeredAt: d.registeredAt || d.createdAt,
  }));
  if (status) {
    rows = rows.filter((m) => m.status === status);
  }
  if (location) {
    rows = rows.filter((m) => m.location === location);
  }
  return rows;
}

/**
 * Group readings by a bucket granularity and reduce each group to summary
 * statistics. Shared by the daily/weekly/monthly analytics exports.
 */
function bucketSummaries(granularity) {
  const groups = new Map();
  for (const r of getReadings()) {
    const key = getBucketKey(r.timestamp, granularity);
    if (!groups.has(key)) {
      groups.set(key, { values: [], meters: new Set(), dayTotals: new Map() });
    }
    const g = groups.get(key);
    g.values.push(r.value);
    g.meters.add(r.meterId);
    if (granularity !== 'day') {
      const dayKey = getBucketKey(r.timestamp, 'day');
      g.dayTotals.set(dayKey, (g.dayTotals.get(dayKey) || 0) + r.value);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, g]) => ({ key, ...g }));
}

/** Daily summaries: one row per day with data. */
function computeDailySummaries(startDate, endDate) {
  let rows = bucketSummaries('day').map(({ key, values, meters }) => ({
    date: key,
    totalConsumption: aggregateValues(values, 'sum'),
    averageConsumption: aggregateValues(values, 'avg'),
    peakConsumption: aggregateValues(values, 'max'),
    meterCount: meters.size,
  }));
  if (startDate) rows = rows.filter((r) => r.date >= String(startDate).slice(0, 10));
  if (endDate) rows = rows.filter((r) => r.date <= String(endDate).slice(0, 10));
  return rows;
}

/** Weekly summaries with peak day and per-day average inside each week. */
function computeWeeklySummaries() {
  return bucketSummaries('week').map(({ key, values, meters, dayTotals }) => {
    const weekEnd = new Date(`${key}T00:00:00Z`);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const peakDay = [...dayTotals.entries()].sort((a, b) => b[1] - a[1])[0];
    const total = aggregateValues(values, 'sum');
    return {
      weekStart: key,
      weekEnd: weekEnd.toISOString().slice(0, 10),
      totalConsumption: total,
      averageDailyConsumption: dayTotals.size > 0 ? Math.round((total / dayTotals.size) * 100) / 100 : total,
      peakDay: peakDay ? peakDay[0] : null,
      meterCount: meters.size,
    };
  });
}

/** Monthly summaries with peak day and per-day average inside each month. */
function computeMonthlySummaries() {
  return bucketSummaries('month').map(({ key, values, meters, dayTotals }) => {
    const [year, month] = key.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const peakDay = [...dayTotals.entries()].sort((a, b) => b[1] - a[1])[0];
    const total = aggregateValues(values, 'sum');
    return {
      month: key,
      totalConsumption: total,
      averageDailyConsumption: Math.round((total / daysInMonth) * 100) / 100,
      peakDay: peakDay ? peakDay[0] : null,
      meterCount: meters.size,
    };
  });
}

/** Build the system report from the real stores. */
function buildSystemReport(sections) {
  const report = {};
  if (sections.includes('meters')) report.meters = getExportMeters();
  if (sections.includes('readings')) report.readings = getExportReadings();
  if (sections.includes('alerts')) report.alerts = [];
  if (sections.includes('summary')) {
    report.summary = {
      totalMeters: deviceStore.list().length,
      totalReadings: readingCount(),
      activeAlerts: 0,
      reportGenerated: new Date().toISOString(),
    };
  }
  return report;
}

/**
 * Available fields for each export type. These drive both the field
 * whitelist (?fields=) and the CSV column set, so they must mirror the
 * real export shapes above - a column that no row can fill is a lie in
 * every file we hand to a customer.
 */
const AVAILABLE_FIELDS = {
  readings: ['id', 'meterId', 'timestamp', 'value', 'unit', 'createdAt'],
  analytics: ['date', 'weekStart', 'weekEnd', 'month', 'totalConsumption', 'averageConsumption', 'averageDailyConsumption', 'peakConsumption', 'peakDay', 'meterCount'],
  meters: ['id', 'deviceId', 'name', 'location', 'registeredAt'],
  alerts: ['id', 'type', 'severity', 'message', 'meterId', 'timestamp', 'resolved'],
  summary: ['totalMeters', 'totalReadings', 'activeAlerts', 'reportGenerated'],
};

/**
 * Authentication is enforced by the shared JWT middleware (src/middleware/auth.js):
 * requests must carry a valid `Authorization: Bearer <jwt>` signed with JWT_SECRET.
 * The previous placeholder accepted ANY Bearer token, which made every export
 * endpoint - including the admin-only system report - effectively public.
 *
 * OpenAPI: security is documented per-route via the bearerAuth scheme.
 */

/**
 * Admin authorization is enforced by the shared requireAdmin middleware
 * (src/middleware/requireAdmin.js), which checks the admin role from the
 * verified JWT payload. The previous placeholder trusted a client-controlled
 * `x-role: admin` header, letting anyone promote themselves to admin.
 */

/**
 * @openapi
 * /api/exports/readings:
 *   get:
 *     summary: Export meter readings
 *     description: Export stored meter readings with filtering options in CSV/JSON/NDJSON.
 *     tags: [Exports]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [csv, json, ndjson] }
 *       - in: query
 *         name: meterIds
 *         schema: { type: string }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: fields
 *         schema: { type: string }
 *     responses:
 *       200: { description: Exported readings }
 *       401: { description: Unauthorized }
 */
router.get('/readings', authenticate, validate(exportReadingsQuerySchema), async (req, res) => {
  try {
    log.info({ query: req.query }, 'Export readings request');

    const meterIds = req.query.meterIds
      ? req.query.meterIds.split(',').map((id) => id.trim())
      : undefined;

    const rows = getExportReadings({
      meterIds,
      status: req.query.status,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });

    log.info({ recordCount: rows.length }, 'Exporting readings');

    await handleExport(req, res, rows, AVAILABLE_FIELDS.readings, 'meter-readings');
  } catch (error) {
    log.error({ error }, 'Export readings error');
    if (!res.headersSent) {
      res.status(500).json({ error: 'Export failed', message: error.message });
    }
  }
});

/**
 * @openapi
 * /api/exports/analytics/{summaryType}:
 *   get:
 *     summary: Export analytics summary
 *     description: Export consumption summaries computed from real stored readings (daily, weekly, monthly).
 *     tags: [Exports]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: summaryType
 *         required: true
 *         schema: { type: string, enum: [daily, weekly, monthly] }
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [csv, json, ndjson] }
 *     responses:
 *       200: { description: Exported analytics summary }
 *       400: { description: Invalid summary type }
 *       401: { description: Unauthorized }
 */
router.get('/analytics/:summaryType', authenticate, validate({ ...exportAnalyticsParamsSchema, ...exportAnalyticsQuerySchema }), async (req, res) => {
  try {
    const { summaryType } = req.params;

    log.info({ summaryType, query: req.query }, 'Export analytics request');

    // The params schema already constrains summaryType to daily/weekly/monthly,
    // so this branch is unreachable through validation - kept as a guard
    // because this handler computes per-type.
    const validTypes = ['daily', 'weekly', 'monthly'];
    if (!validTypes.includes(summaryType)) {
      return res.status(400).json({
        error: 'Invalid summary type',
        message: `Valid types: ${validTypes.join(', ')}`,
      });
    }

    let filteredData;
    if (summaryType === 'daily') {
      filteredData = computeDailySummaries(req.query.startDate, req.query.endDate);
    } else if (summaryType === 'weekly') {
      filteredData = computeWeeklySummaries();
    } else {
      filteredData = computeMonthlySummaries();
    }

    log.info({ summaryType, recordCount: filteredData.length }, 'Exporting analytics');

    await handleExport(req, res, filteredData, AVAILABLE_FIELDS.analytics, `analytics-${summaryType}`);
  } catch (error) {
    log.error({ error }, 'Export analytics error');
    if (!res.headersSent) {
      res.status(500).json({ error: 'Export failed', message: error.message });
    }
  }
});

/**
 * @openapi
 * /api/exports/system-report:
 *   get:
 *     summary: Export system-wide report
 *     description: Export a system-wide report combining meters, readings, and alerts. Requires admin role.
 *     tags: [Exports]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [csv, json, ndjson] }
 *       - in: query
 *         name: sections
 *         schema: { type: string }
 *     responses:
 *       200: { description: Exported system report }
 *       401: { description: Unauthorized }
 *       403: { description: Admin role required }
 */
router.get('/system-report', authenticate, requireAdmin, validate(exportSystemReportQuerySchema), async (req, res) => {
  try {
    log.info({ query: req.query }, 'Export system report request');

    const sections = req.query.sections
      ? req.query.sections.split(',').map((s) => s.trim())
      : ['meters', 'readings', 'alerts', 'summary'];

    const reportData = buildSystemReport(sections);

    if (req.query.format === 'csv') {
      // CSV needs one flat row stream; tag each row with its section.
      const exportData = [];
      for (const section of ['meters', 'readings', 'alerts']) {
        for (const row of reportData[section] || []) {
          exportData.push({ ...row, _section: section });
        }
      }
      if (reportData.summary) {
        exportData.push({ ...reportData.summary, _section: 'summary' });
      }

      const allFields = sections.flatMap((s) => AVAILABLE_FIELDS[s] || []);
      log.info({ sections, recordCount: exportData.length }, 'Exporting system report');
      await handleExport(req, res, exportData, allFields.concat('_section'), 'system-report');
    } else {
      // JSON/NDJSON keep the nested structure.
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="system-report.json"');
      res.json(reportData);
    }
  } catch (error) {
    log.error({ error }, 'Export system report error');
    if (!res.headersSent) {
      res.status(500).json({ error: 'Export failed', message: error.message });
    }
  }
});

/**
 * @openapi
 * /api/exports/meters:
 *   get:
 *     summary: Export meter registry
 *     description: Export the registered device registry with optional location filter.
 *     tags: [Exports]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [csv, json, ndjson] }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: location
 *         schema: { type: string }
 *     responses:
 *       200: { description: Exported meters }
 *       401: { description: Unauthorized }
 */
router.get('/meters', authenticate, validate(exportMetersQuerySchema), async (req, res) => {
  try {
    log.info({ query: req.query }, 'Export meters request');

    const rows = getExportMeters({
      status: req.query.status,
      location: req.query.location,
    });

    log.info({ recordCount: rows.length }, 'Exporting meters');

    await handleExport(req, res, rows, AVAILABLE_FIELDS.meters, 'meters');
  } catch (error) {
    log.error({ error }, 'Export meters error');
    if (!res.headersSent) {
      res.status(500).json({ error: 'Export failed', message: error.message });
    }
  }
});

module.exports = router;

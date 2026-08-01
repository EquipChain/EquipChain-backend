// src/schemas/metering.schema.js
//
// Zod validation schemas for metering/export endpoints (issue #8).
// Covers the export routes that were missing validation in src/routes/exports.js.

const { z } = require('zod');
const { isoDateString, paginationQuerySchema } = require('./common.schema');

/**
 * Query params for listing meter readings via export endpoints.
 */
const readingsQuerySchema = paginationQuerySchema.extend({
  meterId: z.string().min(1).optional(),
  status: z.enum(['verified', 'pending', 'rejected']).optional(),
  unit: z.enum(['kWh', 'kW', 'V', 'A', 'VAR', 'VA']).optional(),
  startDate: isoDateString.optional(),
  endDate: isoDateString.optional(),
});

/**
 * Query params for analytics export endpoints.
 */
const analyticsExportSchema = z.object({
  startDate: isoDateString.optional(),
  endDate: isoDateString.optional(),
  granularity: z.enum(['hour', 'day', 'week', 'month']).default('day'),
  format: z.enum(['json', 'csv']).default('json'),
});

/**
 * Body schema for creating a meter reading submission.
 */
const createReadingSchema = z.object({
  meterId: z.string().min(1),
  timestamp: isoDateString,
  value: z.number().finite(),
  unit: z.enum(['kWh', 'kW', 'V', 'A', 'VAR', 'VA']),
  status: z.enum(['verified', 'pending', 'rejected']).default('pending'),
}).strict();

/**
 * Body schema for bulk reading import.
 */
const bulkReadingsSchema = z.object({
  readings: z.array(createReadingSchema).min(1).max(1000),
}).strict();

module.exports = {
  readingsQuerySchema,
  analyticsExportSchema,
  createReadingSchema,
  bulkReadingsSchema,
};

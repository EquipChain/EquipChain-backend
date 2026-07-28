const { z } = require('zod');
const { isoDateString } = require('./common.schema');

/**
 * Valid granularity options for time-bucket aggregation.
 */
const GRANULARITIES = ['hour', 'day', 'week', 'month'];

/**
 * Valid aggregation function types.
 */
const AGGREGATION_TYPES = ['count', 'sum', 'avg', 'min', 'max', 'p50', 'p95'];

/**
 * Valid comparison modes.
 */
const COMPARISON_MODES = ['previous_period', 'year_over_year'];

/**
 * IANA timezone regex — matches common timezone identifiers like
 * "America/New_York", "Europe/London", "UTC", "Asia/Tokyo", etc.
 */
const IANA_TIMEZONE_REGEX = /^[A-Za-z_]+(\/[A-Za-z_]+)*$/;

/**
 * Schema for querying daily summaries.
 */
const dailySummarySchema = z.object({
  startDate: isoDateString,
  endDate: isoDateString,
  meterIds: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (Array.isArray(val) ? val : [val]))
    .optional(),
  timezone: z.string().regex(IANA_TIMEZONE_REGEX, 'Must be a valid IANA timezone').default('UTC'),
  aggregationType: z.enum(AGGREGATION_TYPES).default('avg'),
  compareWith: z.enum(COMPARISON_MODES).optional(),
});

/**
 * Schema for querying monthly summaries.
 */
const monthlySummarySchema = z.object({
  startDate: isoDateString,
  endDate: isoDateString,
  meterIds: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (Array.isArray(val) ? val : [val]))
    .optional(),
  timezone: z.string().regex(IANA_TIMEZONE_REGEX, 'Must be a valid IANA timezone').default('UTC'),
  aggregationType: z.enum(AGGREGATION_TYPES).default('avg'),
  compareWith: z.enum(COMPARISON_MODES).optional(),
});

/**
 * Schema for querying custom date range with configurable granularity.
 */
const customRangeSchema = z.object({
  startDate: isoDateString,
  endDate: isoDateString,
  granularity: z.enum(GRANULARITIES).default('day'),
  meterIds: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (Array.isArray(val) ? val : [val]))
    .optional(),
  timezone: z.string().regex(IANA_TIMEZONE_REGEX, 'Must be a valid IANA timezone').default('UTC'),
  aggregationType: z.enum(AGGREGATION_TYPES).default('avg'),
});

/**
 * Schema for querying fleet-wide summaries.
 */
const fleetSummarySchema = z.object({
  startDate: isoDateString.optional(),
  endDate: isoDateString.optional(),
  aggregationType: z.enum(AGGREGATION_TYPES).default('avg'),
});

module.exports = {
  GRANULARITIES,
  AGGREGATION_TYPES,
  COMPARISON_MODES,
  dailySummarySchema,
  monthlySummarySchema,
  customRangeSchema,
  fleetSummarySchema,
};

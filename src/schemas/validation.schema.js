const { z } = require('zod');

/**
 * Common validation patterns
 */
const uuidSchema = z.string().uuid();
const idParamSchema = z.object({ id: z.string().min(1) });
const dateSchema = z.string().refine(
  (val) => !isNaN(Date.parse(val)),
  { message: 'Must be a valid ISO 8601 date' }
);

/**
 * Auth schemas
 */
const authChallengeSchema = {
  body: z.object({
    wallet: z.string().min(1).optional(),
  }),
};

const protectedQuerySchema = {
  query: z.object({}).passthrough(),
};

/**
 * Analytics schemas
 */
const dailySummaryQuerySchema = {
  query: z.object({
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    meterIds: z.union([z.string(), z.array(z.string())]).transform(
      (val) => (Array.isArray(val) ? val : val.split(',').map((s) => s.trim()))
    ).optional(),
    timezone: z.string().optional().default('UTC'),
    aggregationType: z.enum(['count', 'sum', 'avg', 'min', 'max', 'p50', 'p95']).optional().default('avg'),
    compareWith: z.enum(['previous_period', 'year_over_year']).optional(),
  }),
};

const monthlySummaryQuerySchema = {
  query: z.object({
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    meterIds: z.union([z.string(), z.array(z.string())]).transform(
      (val) => (Array.isArray(val) ? val : val.split(',').map((s) => s.trim()))
    ).optional(),
    timezone: z.string().optional().default('UTC'),
    aggregationType: z.enum(['count', 'sum', 'avg', 'min', 'max', 'p50', 'p95']).optional().default('avg'),
    compareWith: z.enum(['previous_period', 'year_over_year']).optional(),
  }),
};

const customRangeQuerySchema = {
  query: z.object({
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    granularity: z.enum(['hour', 'day', 'week', 'month']).optional().default('day'),
    meterIds: z.union([z.string(), z.array(z.string())]).transform(
      (val) => (Array.isArray(val) ? val : val.split(',').map((s) => s.trim()))
    ).optional(),
    timezone: z.string().optional().default('UTC'),
    aggregationType: z.enum(['count', 'sum', 'avg', 'min', 'max', 'p50', 'p95']).optional().default('avg'),
  }),
};

const fleetSummaryQuerySchema = {
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    aggregationType: z.enum(['count', 'sum', 'avg', 'min', 'max', 'p50', 'p95']).optional().default('avg'),
  }),
};

/**
 * Export schemas
 */
const exportReadingsQuerySchema = {
  query: z.object({
    format: z.enum(['csv', 'json', 'ndjson']).optional().default('csv'),
    fields: z.string().optional(),
    meterIds: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    status: z.string().optional(),
    pretty: z.enum(['true', 'false']).optional(),
  }),
};

const exportAnalyticsParamsSchema = {
  params: z.object({
    summaryType: z.enum(['daily', 'weekly', 'monthly']),
  }),
};

const exportAnalyticsQuerySchema = {
  query: z.object({
    format: z.enum(['csv', 'json', 'ndjson']).optional().default('csv'),
    fields: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    pretty: z.enum(['true', 'false']).optional(),
  }),
};

const exportMetersQuerySchema = {
  query: z.object({
    format: z.enum(['csv', 'json', 'ndjson']).optional().default('csv'),
    fields: z.string().optional(),
    status: z.string().optional(),
    location: z.string().optional(),
    pretty: z.enum(['true', 'false']).optional(),
  }),
};

const exportSystemReportQuerySchema = {
  query: z.object({
    format: z.enum(['csv', 'json', 'ndjson']).optional().default('json'),
    fields: z.string().optional(),
    sections: z.string().optional(),
    pretty: z.enum(['true', 'false']).optional(),
  }),
};

/**
 * Admin schemas
 */
const adminCreateUserSchema = {
  body: z.object({
    email: z.string().email('Invalid email format'),
    name: z.string().min(1, 'Name is required'),
    roles: z.array(z.enum(['admin', 'user'])).optional().default(['user']),
  }),
};

const adminUpdateUserRolesSchema = {
  body: z.object({
    roles: z.array(z.enum(['admin', 'user'])).min(1, 'At least one role required'),
  }),
};

const adminConfigUpdateSchema = {
  body: z.object({
    values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .refine((v) => Object.keys(v).length > 0, {
        message: 'At least one configuration value must be provided',
      }),
  }),
};

const adminRegisterDeviceSchema = {
  body: z.object({
    deviceId: z.string().min(1, 'Device ID is required'),
    name: z.string().min(1, 'Name is required'),
    location: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  }),
};

const adminUpdateDeviceSchema = {
  body: z.object({
    name: z.string().min(1).optional(),
    location: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  }).refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  }),
};

const adminIdParamSchema = {
  params: z.object({
    id: z.string().min(1),
  }),
};

module.exports = {
  idParamSchema,
  authChallengeSchema,
  dailySummaryQuerySchema,
  monthlySummaryQuerySchema,
  customRangeQuerySchema,
  fleetSummaryQuerySchema,
  exportReadingsQuerySchema,
  exportAnalyticsParamsSchema,
  exportAnalyticsQuerySchema,
  exportMetersQuerySchema,
  exportSystemReportQuerySchema,
  adminCreateUserSchema,
  adminUpdateUserRolesSchema,
  adminConfigUpdateSchema,
  adminRegisterDeviceSchema,
  adminUpdateDeviceSchema,
  adminIdParamSchema,
};

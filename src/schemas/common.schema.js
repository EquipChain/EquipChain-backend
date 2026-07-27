const { z } = require('zod');

const {
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  isIsoDateString,
} = require('../utils/pagination');

/**
 * Date bounds are validated with the utilities' own predicate rather than Zod's
 * .datetime(), which rejects a plain `2024-01-01`. Sharing the predicate keeps the
 * schema and filterByDateRange from drifting apart: anything one accepts, the other
 * can parse.
 */
const isoDateString = z
  .string()
  .refine(isIsoDateString, { message: 'must be an ISO 8601 date or date-time' });

/**
 * Query parameters shared by every list endpoint. Values arrive as strings, so page and
 * limit are coerced. Unknown keys are stripped by Zod, which is the whitelist behaviour
 * list endpoints want — declare domain filters via makeListQuerySchema to accept them.
 *
 * `sortBy` is an unconstrained string here because the base schema cannot know an
 * endpoint's columns. Prefer makeListQuerySchema({ sortableFields }) so an unsupported
 * sort field is rejected at validation time instead of throwing inside applySorting.
 */
const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  q: z.string().max(200).optional(),
  createdAfter: isoDateString.optional(),
  createdBefore: isoDateString.optional(),
});

/**
 * Builds an endpoint-specific query schema on top of paginationQuerySchema.
 *
 * @param {{ sortableFields?: string[], filters?: string[] }} [config]
 *   sortableFields narrows sortBy to that set; filters are added as optional strings so
 *   they survive Zod's stripping of unknown keys.
 * @returns {import('zod').ZodObject}
 */
function makeListQuerySchema(config = {}) {
  const { sortableFields = [], filters = [] } = config || {};
  const shape = {};

  if (sortableFields.length > 0) {
    shape.sortBy = z.enum(sortableFields).optional();
  }

  for (const filter of filters) {
    shape[filter] = z.string().min(1).optional();
  }

  return paginationQuerySchema.extend(shape);
}

module.exports = {
  paginationQuerySchema,
  makeListQuerySchema,
  isoDateString,
};

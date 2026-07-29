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

/**
 * Query parameters for endpoints that offer cursor pagination alongside offset pagination.
 *
 * `paginate` defaults to 'offset' so an existing client that knows nothing about cursors
 * keeps the issue #17 response shape. In cursor mode the caller sends `cursor` to move
 * forward or `before` to move back — never both, which the refine below rejects at the
 * edge rather than letting it reach paginateCursor. `page` is deliberately absent: it has
 * no meaning for keyset paging, and accepting it would imply the two can be mixed.
 *
 * Cursors are opaque. They are validated as non-empty strings only, because their real
 * validation is decoding them and checking the sort they were minted for, which the schema
 * cannot do without knowing the endpoint's sort.
 *
 * Note that sortOrder defaults to 'asc' here, so a query validated by this schema always
 * carries a value and options.defaultSort.order will never apply — the same trap flagged
 * in paginateAndFilter's JSDoc. Endpoints over append-heavy data (readings, delivery logs)
 * usually want newest-first and must pass sortOrder explicitly or relax this default.
 */
const cursorQuerySchema = z
  .object({
    paginate: z.enum(['offset', 'cursor']).default('offset'),
    cursor: z.string().min(1).optional(),
    before: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).default('asc'),
    q: z.string().max(200).optional(),
    createdAfter: isoDateString.optional(),
    createdBefore: isoDateString.optional(),
  })
  .refine((query) => !(query.cursor && query.before), {
    message: 'cursor and before cannot be combined; supply one direction at a time',
    path: ['cursor'],
  });

/**
 * Builds an endpoint-specific cursor query schema, mirroring makeListQuerySchema.
 *
 * Uses .safeExtend rather than .extend: narrowing sortBy overwrites a key that already
 * exists, and Zod 4 refuses that on a schema carrying refinements. safeExtend allows it and
 * carries the cursor/before conflict check through to the extended schema.
 *
 * @param {{ sortableFields?: string[], filters?: string[] }} [config]
 *   sortableFields narrows sortBy to that set; filters are added as optional strings so
 *   they survive Zod's stripping of unknown keys.
 * @returns {import('zod').ZodTypeAny}
 */
function makeCursorListQuerySchema(config = {}) {
  const { sortableFields = [], filters = [] } = config || {};
  const shape = {};

  if (sortableFields.length > 0) {
    shape.sortBy = z.enum(sortableFields).optional();
  }

  for (const filter of filters) {
    shape[filter] = z.string().min(1).optional();
  }

  return cursorQuerySchema.safeExtend(shape);
}

module.exports = {
  paginationQuerySchema,
  makeListQuerySchema,
  cursorQuerySchema,
  makeCursorListQuerySchema,
  isoDateString,
};

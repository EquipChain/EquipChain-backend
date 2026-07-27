const { ValidationError } = require('./errors');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Query params consumed by the utilities themselves, so they are never mistaken for filters.
const RESERVED_PARAMS = ['page', 'limit', 'sortBy', 'sortOrder', 'q', 'createdAfter', 'createdBefore'];

const SORT_ORDERS = ['asc', 'desc'];

const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

function assertArray(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array`);
  }
}

/**
 * Parses a value into a timestamp, but only for Date instances and ISO-8601-looking
 * strings. Date.parse is lenient enough to turn '2' into a real date, which would make
 * ordinary strings sort as dates, so the format is checked first.
 * Returns null when the value is not a usable date.
 */
function toTimestamp(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }

  if (typeof value !== 'string' || !ISO_DATE_PREFIX.test(value)) {
    return null;
  }

  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/**
 * True when a value is a date this module can actually filter on — an ISO 8601 date
 * (`2024-01-01`) or datetime (`2024-01-01T00:00:00Z`).
 *
 * paginationQuerySchema validates createdAfter/createdBefore with this exact predicate,
 * so the schema can never accept a bound the utilities reject, or vice versa.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isIsoDateString(value) {
  return typeof value === 'string' && toTimestamp(value) !== null;
}

/**
 * Accepts a positive integer as either a number or the numeric string that arrives on
 * req.query. Returns null when the value cannot be one.
 */
function toPositiveInteger(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1 ? value : null;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
  }

  return null;
}

function resolveMaxLimit(maxLimit) {
  if (maxLimit === undefined || maxLimit === null) {
    return MAX_LIMIT;
  }

  const resolved = toPositiveInteger(maxLimit);
  if (resolved === null) {
    throw new TypeError('options.maxLimit must be a positive integer');
  }

  return resolved;
}

/**
 * Validates page and limit together so a request with both wrong reports both problems
 * at once, rather than making the caller fix them one round trip at a time.
 */
function parsePageParams(page, limit, maxLimit) {
  const details = [];

  let resolvedPage = DEFAULT_PAGE;
  if (page !== undefined && page !== null) {
    resolvedPage = toPositiveInteger(page);
    if (resolvedPage === null) {
      details.push({ field: 'page', message: 'page must be an integer greater than or equal to 1' });
    }
  }

  let resolvedLimit = DEFAULT_LIMIT;
  if (limit !== undefined && limit !== null) {
    resolvedLimit = toPositiveInteger(limit);
    if (resolvedLimit === null) {
      details.push({ field: 'limit', message: 'limit must be an integer greater than or equal to 1' });
    } else if (resolvedLimit > maxLimit) {
      details.push({ field: 'limit', message: `limit must not be greater than ${maxLimit}` });
    }
  }

  if (details.length > 0) {
    throw new ValidationError(details);
  }

  return { page: resolvedPage, limit: resolvedLimit };
}

function compareValues(left, right) {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  const leftTime = toTimestamp(left);
  const rightTime = toTimestamp(right);
  if (leftTime !== null && rightTime !== null) {
    return leftTime - rightTime;
  }

  const leftText = String(left);
  const rightText = String(right);
  if (leftText === rightText) return 0;
  return leftText < rightText ? -1 : 1;
}

/**
 * Validates raw page/limit query values and resolves them into the numbers a data source
 * needs, including a zero-based `offset` for SQL LIMIT/OFFSET.
 *
 * This is the database-backed half of the utility: a repository that cannot afford to
 * load every row calls this for the query bounds, then buildPaginationMeta with the
 * COUNT(*) total. The in-memory paginate() is those two composed over an array, so both
 * paths validate identically and emit the same envelope.
 *
 * @param {{ page?: number|string, limit?: number|string, maxLimit?: number }} [params]
 * @returns {{ page: number, limit: number, offset: number }}
 * @throws {ValidationError} when page or limit is out of range or not an integer
 */
function getPaginationParams(params = {}) {
  const { page, limit, maxLimit } = params || {};
  const resolvedMax = resolveMaxLimit(maxLimit);
  const { page: currentPage, limit: perPage } = parsePageParams(page, limit, resolvedMax);

  return {
    page: currentPage,
    limit: perPage,
    offset: (currentPage - 1) * perPage,
  };
}

/**
 * Builds the pagination metadata block from a page, a limit and a known total. Pair with
 * getPaginationParams when the rows come from a database and `total` is a COUNT(*).
 *
 * @param {{ page?: number|string, limit?: number|string, total: number, maxLimit?: number }} params
 * @returns {{ page: number, limit: number, total: number, totalPages: number,
 *   hasNext: boolean, hasPrev: boolean }}
 * @throws {ValidationError} when page or limit is invalid
 * @throws {TypeError} when total is not a non-negative integer
 */
function buildPaginationMeta(params = {}) {
  const { page, limit, total, maxLimit } = params || {};

  if (!Number.isInteger(total) || total < 0) {
    throw new TypeError('total must be a non-negative integer');
  }

  const resolvedMax = resolveMaxLimit(maxLimit);
  const { page: currentPage, limit: perPage } = parsePageParams(page, limit, resolvedMax);
  const totalPages = Math.ceil(total / perPage);

  return {
    page: currentPage,
    limit: perPage,
    total,
    totalPages,
    hasNext: currentPage < totalPages,
    hasPrev: currentPage > 1,
  };
}

/**
 * Slices an array into a page and returns it alongside pagination metadata.
 *
 * Invalid page/limit values throw a ValidationError (statusCode 400) listing every
 * offending field, so a bad request surfaces instead of being silently reinterpreted.
 * Omitting either value is not an error — page falls back to 1 and limit to 20.
 *
 * A page past the end of the data is a valid request with no results: the requested page
 * is echoed back with an empty array, and total/totalPages still describe the full data
 * set. The page is deliberately not clamped to the last one, because returning page 5's
 * rows under `page: 999` would hand a paging client duplicate records with no way to
 * detect it.
 *
 * @param {Array} data
 * @param {{ page?: number|string, limit?: number|string, maxLimit?: number }} [params]
 * @returns {{ data: Array, pagination: { page: number, limit: number, total: number,
 *   totalPages: number, hasNext: boolean, hasPrev: boolean } }}
 * @throws {ValidationError} when page or limit is out of range or not an integer
 * @throws {TypeError} when data is not an array
 */
function paginate(data, params = {}) {
  assertArray(data, 'data');

  const { limit, offset } = getPaginationParams(params);
  const { page, maxLimit } = params || {};

  return {
    data: data.slice(offset, offset + limit),
    pagination: buildPaginationMeta({ page, limit, total: data.length, maxLimit }),
  };
}

/**
 * Applies exact-match filters. Only keys present in allowedFields are honoured — this
 * whitelist is what stops callers from filtering on fields an endpoint does not expose.
 *
 * Unknown keys are ignored rather than rejected: real query strings pick up unrelated
 * parameters (tracking tags, client state) and failing the request over them would be
 * hostile. Values arrive from the query string, so both sides are compared as strings.
 *
 * @param {Array} data
 * @param {Object} filters
 * @param {string[]} allowedFields
 * @returns {Array}
 * @throws {TypeError} when data or allowedFields is not an array
 */
function filterData(data, filters, allowedFields) {
  assertArray(data, 'data');
  assertArray(allowedFields, 'allowedFields');

  if (!filters || allowedFields.length === 0) {
    return data;
  }

  const active = Object.entries(filters).filter(
    ([field, value]) =>
      allowedFields.includes(field) && value !== undefined && value !== null && value !== ''
  );

  if (active.length === 0) {
    return data;
  }

  return data.filter((item) =>
    active.every(([field, value]) => String(item?.[field]) === String(value))
  );
}

/**
 * Returns a new array sorted by sortBy. Omitting sortBy is a no-op, but asking for a
 * field outside allowedFields throws a ValidationError — silently returning unsorted
 * rows would look like the sort had been applied. Null/undefined values sort last in
 * both directions.
 *
 * @param {Array} data
 * @param {string} [sortBy]
 * @param {'asc'|'desc'} [sortOrder]
 * @param {string[]} allowedFields
 * @returns {Array}
 * @throws {ValidationError} when sortBy is not whitelisted or sortOrder is not asc/desc
 * @throws {TypeError} when data or allowedFields is not an array
 */
function applySorting(data, sortBy, sortOrder, allowedFields) {
  assertArray(data, 'data');
  assertArray(allowedFields, 'allowedFields');

  if (sortOrder !== undefined && sortOrder !== null && !SORT_ORDERS.includes(sortOrder)) {
    throw new ValidationError({
      field: 'sortOrder',
      message: `sortOrder must be one of: ${SORT_ORDERS.join(', ')}`,
    });
  }

  if (sortBy === undefined || sortBy === null || sortBy === '') {
    return data;
  }

  if (!allowedFields.includes(sortBy)) {
    throw new ValidationError({
      field: 'sortBy',
      message:
        allowedFields.length > 0
          ? `sortBy must be one of: ${allowedFields.join(', ')}`
          : 'sortBy is not supported by this endpoint',
    });
  }

  const direction = sortOrder === 'desc' ? -1 : 1;

  return [...data].sort((leftItem, rightItem) => {
    const left = leftItem?.[sortBy];
    const right = rightItem?.[sortBy];

    const leftMissing = left === null || left === undefined;
    const rightMissing = right === null || right === undefined;
    if (leftMissing && rightMissing) return 0;
    if (leftMissing) return 1;
    if (rightMissing) return -1;

    return direction * compareValues(left, right);
  });
}

/**
 * Case-insensitive substring search across searchableFields. Matching uses
 * String.includes rather than a regex, so special characters in the term are literal.
 * An empty or whitespace-only query returns the data untouched.
 *
 * @param {Array} data
 * @param {string} [query]
 * @param {string[]} searchableFields
 * @returns {Array}
 * @throws {ValidationError} when query is present but not a string
 * @throws {TypeError} when data or searchableFields is not an array
 */
function searchData(data, query, searchableFields) {
  assertArray(data, 'data');
  assertArray(searchableFields, 'searchableFields');

  if (query === undefined || query === null) {
    return data;
  }

  if (typeof query !== 'string') {
    throw new ValidationError({ field: 'q', message: 'q must be a string' });
  }

  const term = query.trim().toLowerCase();
  if (!term || searchableFields.length === 0) {
    return data;
  }

  return data.filter((item) =>
    searchableFields.some((field) => {
      const value = item?.[field];
      if (value === null || value === undefined) return false;
      return String(value).toLowerCase().includes(term);
    })
  );
}

/**
 * Filters by an inclusive date range on dateField. A bound that is present but not a
 * parseable date throws, since silently ignoring it would return rows the caller
 * explicitly asked to exclude. Rows whose own date is unparseable fall outside any
 * active range.
 *
 * @throws {ValidationError} when a supplied bound is not a valid date
 */
function filterByDateRange(data, after, before, dateField) {
  assertArray(data, 'data');

  const details = [];

  let afterTime = null;
  if (after !== undefined && after !== null && after !== '') {
    afterTime = toTimestamp(after);
    if (afterTime === null) {
      details.push({ field: 'createdAfter', message: 'createdAfter must be a valid ISO 8601 date' });
    }
  }

  let beforeTime = null;
  if (before !== undefined && before !== null && before !== '') {
    beforeTime = toTimestamp(before);
    if (beforeTime === null) {
      details.push({
        field: 'createdBefore',
        message: 'createdBefore must be a valid ISO 8601 date',
      });
    }
  }

  if (details.length > 0) {
    throw new ValidationError(details);
  }

  if (afterTime === null && beforeTime === null) {
    return data;
  }

  return data.filter((item) => {
    const time = toTimestamp(item?.[dateField]);
    if (time === null) return false;
    if (afterTime !== null && time < afterTime) return false;
    if (beforeTime !== null && time > beforeTime) return false;
    return true;
  });
}

/**
 * Chains search -> filter -> date range -> sort -> paginate in one call, returning the
 * standard { data, pagination } envelope. `total` reflects the count after filtering,
 * not the size of the input.
 *
 * Any query param that is not reserved (page, limit, sortBy, sortOrder, q, createdAfter,
 * createdBefore) is treated as a candidate exact-match filter and still has to pass the
 * options.allowedFilters whitelist.
 *
 * Note: options.defaultSort.order only applies when the caller did not supply sortOrder.
 * paginationQuerySchema defaults sortOrder to 'asc', so endpoints that want a descending
 * default should either pass sortOrder explicitly or relax that schema default.
 *
 * Validate the query with makeListQuerySchema({ sortableFields }) rather than the bare
 * paginationQuerySchema: the base schema leaves sortBy an unconstrained string, so an
 * unsupported field would reach applySorting and throw there instead of being reported
 * as a clean validation failure at the edge.
 *
 * @param {Array} data
 * @param {Object} queryParams
 * @param {{ allowedFilters?: string[], searchableFields?: string[], sortableFields?: string[],
 *   defaultSort?: { field?: string, order?: 'asc'|'desc' }, maxLimit?: number,
 *   dateField?: string }} [options]
 * @throws {ValidationError} for any invalid query parameter
 * @throws {TypeError} when data or an options whitelist is not an array
 */
function paginateAndFilter(data, queryParams = {}, options = {}) {
  assertArray(data, 'data');

  const {
    allowedFilters = [],
    searchableFields = [],
    defaultSort = {},
    maxLimit,
    dateField = 'createdAt',
  } = options || {};

  const query = queryParams || {};

  // Sorting defaults to the filterable fields plus the default sort field unless the
  // endpoint declares its own sortable whitelist.
  const sortableFields =
    options?.sortableFields || [...allowedFilters, defaultSort.field].filter(Boolean);

  const filters = {};
  for (const [key, value] of Object.entries(query)) {
    if (!RESERVED_PARAMS.includes(key)) {
      filters[key] = value;
    }
  }

  let result = searchData(data, query.q, searchableFields);
  result = filterData(result, filters, allowedFilters);
  result = filterByDateRange(result, query.createdAfter, query.createdBefore, dateField);

  const sortBy = query.sortBy || defaultSort.field;
  const sortOrder = query.sortOrder || defaultSort.order;
  result = applySorting(result, sortBy, sortOrder, sortableFields);

  return paginate(result, { page: query.page, limit: query.limit, maxLimit });
}

module.exports = {
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  RESERVED_PARAMS,
  ValidationError,
  isIsoDateString,
  getPaginationParams,
  buildPaginationMeta,
  paginate,
  filterData,
  applySorting,
  searchData,
  paginateAndFilter,
  // Issue #17 names the combined entry point applyPagination in its description and
  // paginateAndFilter in its implementation steps; both resolve to the same function.
  applyPagination: paginateAndFilter,
};

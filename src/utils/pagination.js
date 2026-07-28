const { ValidationError } = require('./errors');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Query params consumed by the utilities themselves, so they are never mistaken for filters.
const RESERVED_PARAMS = [
  'page',
  'limit',
  'sortBy',
  'sortOrder',
  'q',
  'createdAfter',
  'createdBefore',
  'paginate',
  'cursor',
  'before',
];

const SORT_ORDERS = ['asc', 'desc'];

const PAGINATION_MODES = ['offset', 'cursor'];

// Bumped only if the cursor payload shape changes. Cursors minted by an older version are
// rejected rather than misread, so a deploy cannot hand clients a cursor that silently
// pages through the wrong column.
const CURSOR_VERSION = 1;

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
 * Validates a sortBy/sortOrder pair against a whitelist. Returns true when a sort should
 * actually be applied, false when sortBy was omitted (a no-op, not an error).
 *
 * Split out of applySorting so the cursor functions can enforce the identical contract
 * without going through applySorting, which sorts on the primary field alone — keyset
 * paging additionally needs a tiebreaker to make the order total.
 */
function assertSortable(sortBy, sortOrder, allowedFields) {
  if (sortOrder !== undefined && sortOrder !== null && !SORT_ORDERS.includes(sortOrder)) {
    throw new ValidationError({
      field: 'sortOrder',
      message: `sortOrder must be one of: ${SORT_ORDERS.join(', ')}`,
    });
  }

  if (sortBy === undefined || sortBy === null || sortBy === '') {
    return false;
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

  return true;
}

/**
 * Builds the comparator applySorting sorts with. Null/undefined values sort last in both
 * directions, which is why the direction multiplier is applied to compareValues only and
 * not to the missing-value branches.
 */
function makeSortComparator(sortBy, sortOrder) {
  const direction = sortOrder === 'desc' ? -1 : 1;

  return (leftItem, rightItem) => {
    const left = leftItem?.[sortBy];
    const right = rightItem?.[sortBy];

    const leftMissing = left === null || left === undefined;
    const rightMissing = right === null || right === undefined;
    if (leftMissing && rightMissing) return 0;
    if (leftMissing) return 1;
    if (rightMissing) return -1;

    return direction * compareValues(left, right);
  };
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

  if (!assertSortable(sortBy, sortOrder, allowedFields)) {
    return data;
  }

  return [...data].sort(makeSortComparator(sortBy, sortOrder));
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

/**
 * Encodes a cursor payload as a URL-safe base64 string.
 *
 * The result is deliberately opaque to clients: they receive it in a response and pass it
 * back unchanged. base64url is an *encoding*, not a protection — anyone can decode and
 * forge one — so integrity comes from the payload describing the sort it was minted for,
 * which paginateCursor checks against the incoming request. A forged cursor can therefore
 * only reposition the caller within data it is already allowed to page through.
 *
 * @param {*} value any JSON-serializable value; the cursor functions store an object
 * @returns {string} base64url text
 * @throws {TypeError} when the value cannot be JSON-serialized (a programmer error)
 */
function encodeCursor(value) {
  let json;

  try {
    json = JSON.stringify(value);
  } catch (error) {
    throw new TypeError(`cursor value must be JSON-serializable: ${error.message}`);
  }

  if (json === undefined) {
    throw new TypeError('cursor value must be JSON-serializable');
  }

  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decodes a cursor produced by encodeCursor, returning null for anything malformed rather
 * than throwing — callers decide whether a bad cursor is a 400 (it is, at the request
 * edge) or simply absent.
 *
 * Note that Buffer.from(text, 'base64url') never throws: it silently drops characters
 * outside the alphabet and returns whatever bytes remain. Garbage in therefore reaches
 * JSON.parse, which is the check that actually rejects it — hence the try/catch here
 * rather than around the decode.
 *
 * @param {unknown} cursor
 * @returns {*} the decoded value, or null when the input is not a decodable cursor
 */
function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || cursor.trim() === '') {
    return null;
  }

  const json = Buffer.from(cursor, 'base64url').toString('utf8');
  if (json === '') {
    return null;
  }

  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Builds the cursor payload for a row. `f`/`o` record the sort this cursor is valid for,
 * `k` is the row's sort value and `id` the tiebreaker that makes the ordering total.
 */
function buildCursorPayload(item, sortBy, sortOrder, idField) {
  return {
    v: CURSOR_VERSION,
    f: sortBy,
    o: sortOrder,
    k: item?.[sortBy] ?? null,
    id: item?.[idField] ?? null,
  };
}

/**
 * Decodes and validates a cursor query parameter, returning the anchor as a synthetic row
 * that the keyset comparator can be run against.
 */
function parseCursorParam(raw, field, sortBy, sortOrder, idField) {
  const reject = (message) => {
    throw new ValidationError({ field, message });
  };

  const decoded = decodeCursor(raw);
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
    reject(`${field} is not a valid pagination cursor`);
  }

  if (decoded.v !== CURSOR_VERSION || !('k' in decoded) || !('id' in decoded)) {
    reject(`${field} is not a valid pagination cursor`);
  }

  if (decoded.f !== sortBy || decoded.o !== sortOrder) {
    reject(
      `${field} was issued for a different sort (${decoded.f} ${decoded.o}); ` +
        `restart pagination without a cursor to sort by ${sortBy} ${sortOrder}`
    );
  }

  return { [sortBy]: decoded.k, [idField]: decoded.id };
}

/**
 * Composes the primary sort with the id tiebreaker into a total order.
 *
 * Without the tiebreaker, keyset paging breaks on any duplicate sort value: given three
 * readings sharing one createdAt, a strict `>` comparison skips two of them and `>=`
 * re-serves them forever. Both parts run in the same direction so the comparator agrees
 * with the order the rows are sorted into.
 */
function makeKeysetComparator(sortBy, sortOrder, idField) {
  const bySortField = makeSortComparator(sortBy, sortOrder);

  if (sortBy === idField) {
    return bySortField;
  }

  const byId = makeSortComparator(idField, sortOrder);
  return (leftItem, rightItem) => bySortField(leftItem, rightItem) || byId(leftItem, rightItem);
}

/**
 * Shared engine for both directions. `direction` is 'forward' (items after the anchor) or
 * 'backward' (the items immediately before it).
 */
function paginateByCursor(data, params, direction) {
  assertArray(data, 'data');

  const {
    cursor,
    before,
    sortBy,
    sortOrder,
    idField = 'id',
    sortableFields,
    maxLimit,
    includeTotal = false,
  } = params || {};

  if (sortableFields !== undefined && sortableFields !== null) {
    assertArray(sortableFields, 'sortableFields');
  }

  const resolvedOrder = sortOrder === undefined || sortOrder === null ? 'asc' : sortOrder;

  if (!SORT_ORDERS.includes(resolvedOrder)) {
    throw new ValidationError({
      field: 'sortOrder',
      message: `sortOrder must be one of: ${SORT_ORDERS.join(', ')}`,
    });
  }

  const requestedSortBy =
    sortBy === undefined || sortBy === null || sortBy === '' ? null : sortBy;

  // Keyset paging needs a deterministic order, so an omitted sortBy falls back to the id
  // rather than leaving the rows in whatever order the source produced them.
  const resolvedSortBy = requestedSortBy === null ? idField : requestedSortBy;

  // Only a caller-supplied sortBy is held to the whitelist. The idField fallback is this
  // module's own choice, not client input, so an endpoint declaring sortableFields: []
  // ("nothing is sortable") still gets a working default order rather than a 400 naming a
  // parameter the caller never sent.
  if (requestedSortBy !== null && sortableFields) {
    assertSortable(requestedSortBy, resolvedOrder, sortableFields);
  }

  // page is not part of cursor pagination, so only limit is validated here.
  const { limit } = parsePageParams(undefined, params?.limit, resolveMaxLimit(maxLimit));

  const comparator = makeKeysetComparator(resolvedSortBy, resolvedOrder, idField);
  const sorted = [...data].sort(comparator);

  // Backward reads `before`, but also accepts `cursor` as an alias so a direct call using
  // the { cursor, limit, sortBy, sortOrder } signature is honoured rather than silently
  // ignored — an ignored anchor would return the last page and look like working output.
  const supplied = (value) => value !== undefined && value !== null && value !== '';
  const usesBefore = direction === 'backward' && supplied(before);
  const rawCursor = usesBefore ? before : cursor;
  const field = usesBefore ? 'before' : 'cursor';
  const anchor = supplied(rawCursor)
    ? parseCursorParam(rawCursor, field, resolvedSortBy, resolvedOrder, idField)
    : null;

  // Positioning compares values, so the anchor row does not have to still exist — a cursor
  // whose row was deleted or filtered out still lands in the right place. A database does
  // this with WHERE (sortField, id) > ($1, $2); in memory it is a scan of an already
  // sorted array, which the sort above dominates anyway.
  let start;
  let end;

  if (direction === 'backward') {
    const boundary = anchor ? sorted.findIndex((item) => comparator(item, anchor) >= 0) : -1;
    end = boundary === -1 ? sorted.length : boundary;
    start = Math.max(0, end - limit);
  } else {
    const boundary = anchor ? sorted.findIndex((item) => comparator(item, anchor) > 0) : 0;
    start = boundary === -1 ? sorted.length : boundary;
    end = Math.min(sorted.length, start + limit);
  }

  const page = sorted.slice(start, end);
  const hasPrev = start > 0;
  const hasNext = end < sorted.length;

  const cursorFor = (item) =>
    encodeCursor(buildCursorPayload(item, resolvedSortBy, resolvedOrder, idField));

  const pagination = {
    limit,
    cursor: rawCursor === undefined || rawCursor === '' ? null : rawCursor,
    // A null nextCursor is the client's signal to stop paging, so cursors are minted only
    // when there is actually something on the other side.
    nextCursor: hasNext && page.length > 0 ? cursorFor(page[page.length - 1]) : null,
    prevCursor: hasPrev && page.length > 0 ? cursorFor(page[0]) : null,
    hasNext,
    hasPrev,
  };

  if (includeTotal) {
    pagination.total = sorted.length;
  }

  return { data: page, pagination };
}

/**
 * Returns the page of items immediately *after* the cursor position, in sort order.
 *
 * Omitting the cursor returns the first page. Because position is resolved by comparing
 * values rather than by locating the anchor row, inserts and deletes elsewhere in the data
 * cannot make a client skip or repeat rows the way offset paging does.
 *
 * @param {Array} data
 * @param {{ cursor?: string, limit?: number|string, sortBy?: string,
 *   sortOrder?: 'asc'|'desc', idField?: string, sortableFields?: string[],
 *   maxLimit?: number, includeTotal?: boolean }} [params]
 * @returns {{ data: Array, pagination: { limit: number, cursor: string|null,
 *   nextCursor: string|null, prevCursor: string|null, hasNext: boolean, hasPrev: boolean,
 *   total?: number } }}
 * @throws {ValidationError} when the cursor is malformed, was minted for another sort, or
 *   limit/sortBy/sortOrder is invalid
 * @throws {TypeError} when data is not an array
 */
function paginateCursorForward(data, params = {}) {
  return paginateByCursor(data, params, 'forward');
}

/**
 * Returns the page of items immediately *before* the cursor position — the "previous page"
 * — still in the request's sort order rather than reversed.
 *
 * The anchor arrives as `before` (the query parameter clients send) or as `cursor`, which
 * is accepted as an alias so a direct call reads naturally either way. The page is the
 * *last* limit items ahead of the anchor, not the first, so stepping back lands adjacent to
 * where the client already was instead of jumping to the start of the data. By the same
 * rule, omitting the anchor means "the page before the end" and returns the final page.
 *
 * @param {Array} data
 * @param {{ before?: string, cursor?: string, limit?: number|string, sortBy?: string,
 *   sortOrder?: 'asc'|'desc', idField?: string, sortableFields?: string[],
 *   maxLimit?: number, includeTotal?: boolean }} [params]
 * @returns {{ data: Array, pagination: Object }} same envelope as paginateCursorForward
 * @throws {ValidationError} when the cursor is malformed or a parameter is invalid
 * @throws {TypeError} when data is not an array
 */
function paginateCursorBackward(data, params = {}) {
  return paginateByCursor(data, params, 'backward');
}

/**
 * Cursor pagination entry point: takes either `cursor` (forward) or `before` (backward)
 * and delegates accordingly. Supplying neither returns the first page.
 *
 * `total`/`totalPages` are absent from the response by default. Counting the full result
 * set is exactly the cost cursor pagination exists to avoid, so it is opt-in through
 * options.includeTotal.
 *
 * @param {Array} data
 * @param {{ cursor?: string, before?: string, limit?: number|string, sortBy?: string,
 *   sortOrder?: 'asc'|'desc', idField?: string, sortableFields?: string[],
 *   maxLimit?: number, includeTotal?: boolean }} [params]
 * @returns {{ data: Array, pagination: Object }}
 * @throws {ValidationError} when both cursor and before are supplied, or either is invalid
 * @throws {TypeError} when data is not an array
 */
function paginateCursor(data, params = {}) {
  const { cursor, before } = params || {};

  const hasCursor = cursor !== undefined && cursor !== null && cursor !== '';
  const hasBefore = before !== undefined && before !== null && before !== '';

  if (hasCursor && hasBefore) {
    throw new ValidationError({
      field: 'cursor',
      message: 'cursor and before cannot be combined; supply one direction at a time',
    });
  }

  return hasBefore
    ? paginateCursorBackward(data, params)
    : paginateCursorForward(data, params);
}

/**
 * The cursor twin of paginateAndFilter: chains search -> filter -> date range -> cursor
 * page, using the same helpers so both modes narrow the data identically and only the
 * final slice differs.
 *
 * Sorting is not delegated to applySorting here — keyset paging sorts by the primary field
 * *and* the id tiebreaker, so paginateCursor does its own ordering with the comparator it
 * will position against. Passing options.sortableFields still enforces the same whitelist.
 *
 * @param {Array} data
 * @param {Object} queryParams parsed query string; cursor, before, limit, sortBy, sortOrder
 * @param {{ allowedFilters?: string[], searchableFields?: string[], sortableFields?: string[],
 *   defaultSort?: { field?: string, order?: 'asc'|'desc' }, idField?: string,
 *   maxLimit?: number, dateField?: string, includeTotal?: boolean }} [options]
 * @returns {{ data: Array, pagination: Object }}
 * @throws {ValidationError} for any invalid query parameter
 * @throws {TypeError} when data or an options whitelist is not an array
 */
function paginateAndFilterCursor(data, queryParams = {}, options = {}) {
  assertArray(data, 'data');

  const {
    allowedFilters = [],
    searchableFields = [],
    defaultSort = {},
    idField = 'id',
    maxLimit,
    dateField = 'createdAt',
    includeTotal = false,
  } = options || {};

  const query = queryParams || {};

  // idField joins the derived whitelist because cursor mode falls back to sorting by it
  // when sortBy is absent — without it the implicit default sort would fail its own check.
  // This is the one place the derived whitelist differs from paginateAndFilter's, and it
  // only shows when an endpoint declares no sortableFields of its own.
  const sortableFields =
    options?.sortableFields || [...allowedFilters, defaultSort.field, idField].filter(Boolean);

  const filters = {};
  for (const [key, value] of Object.entries(query)) {
    if (!RESERVED_PARAMS.includes(key)) {
      filters[key] = value;
    }
  }

  let result = searchData(data, query.q, searchableFields);
  result = filterData(result, filters, allowedFilters);
  result = filterByDateRange(result, query.createdAfter, query.createdBefore, dateField);

  return paginateCursor(result, {
    cursor: query.cursor,
    before: query.before,
    limit: query.limit,
    sortBy: query.sortBy || defaultSort.field,
    sortOrder: query.sortOrder || defaultSort.order,
    idField,
    sortableFields,
    maxLimit,
    includeTotal,
  });
}

/**
 * Selects a pagination strategy from the `paginate` query parameter and runs it, so a list
 * endpoint can offer both without branching itself.
 *
 * The default is 'offset' when the parameter is absent, which keeps every endpoint written
 * against issue #17's envelope working unchanged. 'cursor' switches to keyset paging, whose
 * response carries cursors instead of page/totalPages.
 *
 * @param {Array} data
 * @param {Object} queryParams
 * @param {Object} [options] the union of paginateAndFilter's and paginateAndFilterCursor's
 * @returns {{ data: Array, pagination: Object }} shape depends on the selected mode
 * @throws {ValidationError} when paginate is not 'offset' or 'cursor', or a parameter is invalid
 * @throws {TypeError} when data is not an array
 */
function paginateList(data, queryParams = {}, options = {}) {
  const mode = (queryParams || {}).paginate;

  if (mode === undefined || mode === null || mode === '' || mode === 'offset') {
    return paginateAndFilter(data, queryParams, options);
  }

  if (mode === 'cursor') {
    return paginateAndFilterCursor(data, queryParams, options);
  }

  throw new ValidationError({
    field: 'paginate',
    message: `paginate must be one of: ${PAGINATION_MODES.join(', ')}`,
  });
}

module.exports = {
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  RESERVED_PARAMS,
  PAGINATION_MODES,
  CURSOR_VERSION,
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
  encodeCursor,
  decodeCursor,
  paginateCursorForward,
  paginateCursorBackward,
  paginateCursor,
  paginateAndFilterCursor,
  paginateList,
};

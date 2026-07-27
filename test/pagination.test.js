const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  ValidationError,
  isIsoDateString,
  getPaginationParams,
  buildPaginationMeta,
  paginate,
  filterData,
  applySorting,
  searchData,
  paginateAndFilter,
  applyPagination,
} = require('../src/utils/pagination');

const STATUSES = ['active', 'idle', 'faulty'];
const ROLES = ['admin', 'operator'];

// 25 meters: ids 1..25, statuses cycle every 3, roles alternate, createdAt 2024-01-01..25.
function makeMeters(count = 25) {
  return Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    return {
      id,
      name: `Meter ${id}`,
      status: STATUSES[index % STATUSES.length],
      role: ROLES[index % ROLES.length],
      createdAt: new Date(Date.UTC(2024, 0, id)).toISOString(),
    };
  });
}

// Asserts the call throws a ValidationError whose details name exactly `fields`.
function assertValidationError(fn, fields, message) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof ValidationError, `expected ValidationError, got ${error.name}`);
      assert.strictEqual(error.statusCode, 400);
      assert.strictEqual(error.code, 'VALIDATION_ERROR');
      assert.deepStrictEqual(
        error.details.map((detail) => detail.field),
        fields
      );
      return true;
    },
    message
  );
}

describe('ValidationError', () => {
  it('carries a 400 status and a joined message', () => {
    const error = new ValidationError([
      { field: 'page', message: 'page is bad' },
      { field: 'limit', message: 'limit is bad' },
    ]);

    assert.ok(error instanceof Error);
    assert.strictEqual(error.name, 'ValidationError');
    assert.strictEqual(error.statusCode, 400);
    assert.strictEqual(error.message, 'page is bad; limit is bad');
    assert.strictEqual(error.details.length, 2);
  });
});

describe('isIsoDateString', () => {
  it('accepts ISO dates and date-times', () => {
    assert.strictEqual(isIsoDateString('2024-01-01'), true);
    assert.strictEqual(isIsoDateString('2024-01-01T00:00:00.000Z'), true);
  });

  it('rejects other formats and non-strings', () => {
    for (const value of ['01/01/2024', 'not-a-date', '2024-13-45', '', 42, null, new Date()]) {
      assert.strictEqual(isIsoDateString(value), false, `value=${String(value)}`);
    }
  });
});

describe('getPaginationParams', () => {
  it('resolves a zero-based offset for database queries', () => {
    assert.deepStrictEqual(getPaginationParams({ page: 1, limit: 20 }), {
      page: 1,
      limit: 20,
      offset: 0,
    });
    assert.deepStrictEqual(getPaginationParams({ page: 3, limit: 25 }), {
      page: 3,
      limit: 25,
      offset: 50,
    });
  });

  it('applies the same defaults as paginate', () => {
    assert.deepStrictEqual(getPaginationParams(), { page: 1, limit: DEFAULT_LIMIT, offset: 0 });
  });

  it('coerces query strings and enforces the same validation', () => {
    assert.deepStrictEqual(getPaginationParams({ page: '2', limit: '10' }), {
      page: 2,
      limit: 10,
      offset: 10,
    });
    assertValidationError(() => getPaginationParams({ limit: '101' }), ['limit']);
    assertValidationError(() => getPaginationParams({ page: '0' }), ['page']);
  });
});

describe('buildPaginationMeta', () => {
  it('builds metadata from a COUNT-style total without the rows', () => {
    assert.deepStrictEqual(buildPaginationMeta({ page: 2, limit: 10, total: 95 }), {
      page: 2,
      limit: 10,
      total: 95,
      totalPages: 10,
      hasNext: true,
      hasPrev: true,
    });
  });

  it('matches what paginate produces for the same page of an array', () => {
    const meters = makeMeters();
    const fromArray = paginate(meters, { page: 2, limit: 5 }).pagination;
    const fromTotal = buildPaginationMeta({ page: 2, limit: 5, total: meters.length });

    assert.deepStrictEqual(fromTotal, fromArray);
  });

  it('handles a zero total', () => {
    assert.deepStrictEqual(buildPaginationMeta({ total: 0 }), {
      page: 1,
      limit: DEFAULT_LIMIT,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    });
  });

  it('throws a TypeError for a missing or invalid total', () => {
    assert.throws(() => buildPaginationMeta({ page: 1, limit: 10 }), TypeError);
    assert.throws(() => buildPaginationMeta({ total: -1 }), TypeError);
    assert.throws(() => buildPaginationMeta({ total: 1.5 }), TypeError);
    assert.throws(() => buildPaginationMeta({ total: '10' }), TypeError);
  });

  it('validates page and limit like the rest of the module', () => {
    assertValidationError(() => buildPaginationMeta({ page: 0, total: 10 }), ['page']);
  });
});

describe('paginate', () => {
  it('returns empty metadata for empty data', () => {
    const result = paginate([]);

    assert.deepStrictEqual(result.data, []);
    assert.deepStrictEqual(result.pagination, {
      page: 1,
      limit: DEFAULT_LIMIT,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    });
  });

  it('applies default page and limit when none are given', () => {
    const result = paginate(makeMeters());

    assert.strictEqual(result.data.length, DEFAULT_LIMIT);
    assert.strictEqual(result.data[0].id, 1);
    assert.strictEqual(result.pagination.page, 1);
    assert.strictEqual(result.pagination.limit, 20);
    assert.strictEqual(result.pagination.total, 25);
    assert.strictEqual(result.pagination.totalPages, 2);
  });

  it('reports a single page when everything fits', () => {
    const result = paginate(makeMeters(4), { page: 1, limit: 10 });

    assert.strictEqual(result.data.length, 4);
    assert.strictEqual(result.pagination.totalPages, 1);
    assert.strictEqual(result.pagination.hasNext, false);
    assert.strictEqual(result.pagination.hasPrev, false);
  });

  it('tracks hasNext and hasPrev across multiple pages', () => {
    const meters = makeMeters();

    const first = paginate(meters, { page: 1, limit: 5 });
    assert.strictEqual(first.data[0].id, 1);
    assert.strictEqual(first.pagination.hasNext, true);
    assert.strictEqual(first.pagination.hasPrev, false);

    const middle = paginate(meters, { page: 3, limit: 5 });
    assert.strictEqual(middle.data[0].id, 11);
    assert.strictEqual(middle.data.length, 5);
    assert.strictEqual(middle.pagination.hasNext, true);
    assert.strictEqual(middle.pagination.hasPrev, true);

    const last = paginate(meters, { page: 5, limit: 5 });
    assert.strictEqual(last.data[4].id, 25);
    assert.strictEqual(last.pagination.hasNext, false);
    assert.strictEqual(last.pagination.hasPrev, true);
  });

  it('returns the remainder on a partial last page', () => {
    const result = paginate(makeMeters(23), { page: 5, limit: 5 });

    assert.strictEqual(result.data.length, 3);
    assert.deepStrictEqual(
      result.data.map((meter) => meter.id),
      [21, 22, 23]
    );
    assert.strictEqual(result.pagination.total, 23);
    assert.strictEqual(result.pagination.totalPages, 5);
    assert.strictEqual(result.pagination.hasNext, false);
  });

  it('returns an empty page beyond the last one rather than clamping', () => {
    const result = paginate(makeMeters(), { page: 999, limit: 5 });

    assert.deepStrictEqual(result.data, []);
    assert.deepStrictEqual(result.pagination, {
      page: 999,
      limit: 5,
      total: 25,
      totalPages: 5,
      hasNext: false,
      hasPrev: true,
    });
  });

  it('throws a ValidationError for a page below one or not an integer', () => {
    const meters = makeMeters();

    for (const page of [0, -1, 1.5, 'abc', '', '2.5']) {
      assertValidationError(() => paginate(meters, { page, limit: 5 }), ['page'], `page=${page}`);
    }
  });

  it('throws a ValidationError for a limit outside the allowed range', () => {
    const meters = makeMeters();

    for (const limit of [0, -5, 'abc', 101]) {
      assertValidationError(() => paginate(meters, { limit }), ['limit'], `limit=${limit}`);
    }
  });

  it('reports every invalid pagination field in one error', () => {
    assertValidationError(() => paginate(makeMeters(), { page: 0, limit: 101 }), ['page', 'limit']);
  });

  it('names the effective maximum when a custom maxLimit is exceeded', () => {
    assert.throws(
      () => paginate(makeMeters(), { limit: 50, maxLimit: 10 }),
      (error) => {
        assert.strictEqual(error.details[0].message, 'limit must not be greater than 10');
        return true;
      }
    );

    assert.strictEqual(paginate(makeMeters(), { limit: 10, maxLimit: 10 }).pagination.limit, 10);
  });

  it('accepts the maximum limit itself', () => {
    assert.strictEqual(paginate(makeMeters(), { limit: MAX_LIMIT }).pagination.limit, MAX_LIMIT);
  });

  it('treats omitted page and limit as defaults, not as errors', () => {
    const result = paginate(makeMeters(), { page: undefined, limit: null });

    assert.strictEqual(result.pagination.page, 1);
    assert.strictEqual(result.pagination.limit, DEFAULT_LIMIT);
  });

  it('coerces numeric strings from the query string', () => {
    const result = paginate(makeMeters(), { page: '2', limit: '5' });

    assert.strictEqual(result.pagination.page, 2);
    assert.strictEqual(result.pagination.limit, 5);
    assert.strictEqual(result.data[0].id, 6);
  });

  it('throws a TypeError when data is not an array', () => {
    assert.throws(() => paginate(undefined), TypeError);
    assert.throws(() => paginate({ length: 3 }), TypeError);
  });

  it('does not mutate the source array', () => {
    const meters = makeMeters(5);
    const snapshot = meters.map((meter) => meter.id);

    paginate(meters, { page: 2, limit: 2 });

    assert.deepStrictEqual(
      meters.map((meter) => meter.id),
      snapshot
    );
  });
});

describe('filterData', () => {
  const meters = makeMeters();

  it('filters by a single field', () => {
    const result = filterData(meters, { status: 'active' }, ['status']);

    assert.strictEqual(result.length, 9);
    assert.ok(result.every((meter) => meter.status === 'active'));
  });

  it('combines multiple filters', () => {
    const result = filterData(meters, { status: 'active', role: 'admin' }, ['status', 'role']);

    assert.strictEqual(result.length, 5);
    assert.ok(result.every((meter) => meter.status === 'active' && meter.role === 'admin'));
  });

  it('ignores fields that are not whitelisted', () => {
    const result = filterData(meters, { role: 'admin' }, ['status']);

    assert.strictEqual(result.length, meters.length);
  });

  it('returns an empty array when nothing matches', () => {
    const result = filterData(meters, { status: 'decommissioned' }, ['status']);

    assert.deepStrictEqual(result, []);
  });

  it('matches numeric fields against string query values', () => {
    const result = filterData(meters, { id: '7' }, ['id']);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 7);
  });

  it('skips empty filter values', () => {
    const result = filterData(meters, { status: '', role: undefined }, ['status', 'role']);

    assert.strictEqual(result.length, meters.length);
  });

  it('throws a TypeError when allowedFields is not an array', () => {
    assert.throws(() => filterData(meters, { status: 'active' }, 'status'), TypeError);
  });
});

describe('applySorting', () => {
  const meters = makeMeters(5);

  it('sorts ascending', () => {
    const result = applySorting(meters, 'name', 'asc', ['name']);

    assert.deepStrictEqual(
      result.map((meter) => meter.name),
      ['Meter 1', 'Meter 2', 'Meter 3', 'Meter 4', 'Meter 5']
    );
  });

  it('sorts descending', () => {
    const result = applySorting(meters, 'id', 'desc', ['id']);

    assert.deepStrictEqual(
      result.map((meter) => meter.id),
      [5, 4, 3, 2, 1]
    );
  });

  it('defaults to ascending when sortOrder is omitted', () => {
    const result = applySorting(makeMeters(5).reverse(), 'id', undefined, ['id']);

    assert.deepStrictEqual(
      result.map((meter) => meter.id),
      [1, 2, 3, 4, 5]
    );
  });

  it('sorts ISO date strings chronologically', () => {
    const result = applySorting(meters, 'createdAt', 'desc', ['createdAt']);

    assert.strictEqual(result[0].createdAt, '2024-01-05T00:00:00.000Z');
    assert.strictEqual(result[4].createdAt, '2024-01-01T00:00:00.000Z');
  });

  it('is a no-op when no sort field is requested', () => {
    assert.deepStrictEqual(applySorting(meters, undefined, 'desc', ['id']), meters);
    assert.deepStrictEqual(applySorting(meters, '', 'desc', ['id']), meters);
  });

  it('throws a ValidationError for a sort field outside the whitelist', () => {
    assertValidationError(() => applySorting(meters, 'secret', 'asc', ['id']), ['sortBy']);

    assert.throws(
      () => applySorting(meters, 'secret', 'asc', ['id', 'name']),
      (error) => {
        assert.strictEqual(error.details[0].message, 'sortBy must be one of: id, name');
        return true;
      }
    );
  });

  it('throws a ValidationError for an unknown sort order', () => {
    assertValidationError(() => applySorting(meters, 'id', 'sideways', ['id']), ['sortOrder']);
  });

  it('sorts missing values last in both directions', () => {
    const partial = [{ id: 1, tier: 'b' }, { id: 2 }, { id: 3, tier: 'a' }];

    assert.deepStrictEqual(
      applySorting(partial, 'tier', 'asc', ['tier']).map((item) => item.id),
      [3, 1, 2]
    );
    assert.deepStrictEqual(
      applySorting(partial, 'tier', 'desc', ['tier']).map((item) => item.id),
      [1, 3, 2]
    );
  });

  it('does not mutate the source array', () => {
    const source = makeMeters(5);
    const snapshot = source.map((meter) => meter.id);

    applySorting(source, 'id', 'desc', ['id']);

    assert.deepStrictEqual(
      source.map((meter) => meter.id),
      snapshot
    );
  });
});

describe('searchData', () => {
  const meters = makeMeters();

  it('matches case-insensitively', () => {
    const result = searchData(meters, 'METER 25', ['name']);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 25);
  });

  it('matches substrings across the whole set', () => {
    const result = searchData(meters, 'meter 1', ['name']);

    // Meter 1 plus Meter 10..19
    assert.strictEqual(result.length, 11);
  });

  it('returns an empty array when nothing matches', () => {
    assert.deepStrictEqual(searchData(meters, 'turbine', ['name']), []);
  });

  it('searches across multiple fields', () => {
    const result = searchData(meters, 'faulty', ['name', 'status']);

    assert.strictEqual(result.length, 8);
    assert.ok(result.every((meter) => meter.status === 'faulty'));
  });

  it('treats a multi-word query as one substring', () => {
    const records = [{ label: 'north wing meter' }, { label: 'north meter wing' }];
    const result = searchData(records, 'north wing', ['label']);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].label, 'north wing meter');
  });

  it('treats regex special characters literally', () => {
    const records = [{ name: 'meter.*' }, { name: 'meter (spare)' }, { name: 'meter one' }];

    assert.deepStrictEqual(searchData(records, '.*', ['name']), [{ name: 'meter.*' }]);
    assert.deepStrictEqual(searchData(records, '(spare)', ['name']), [{ name: 'meter (spare)' }]);
  });

  it('returns everything for an empty, whitespace, or absent query', () => {
    assert.strictEqual(searchData(meters, '', ['name']).length, meters.length);
    assert.strictEqual(searchData(meters, '   ', ['name']).length, meters.length);
    assert.strictEqual(searchData(meters, undefined, ['name']).length, meters.length);
  });

  it('throws a ValidationError when the query is not a string', () => {
    assertValidationError(() => searchData(meters, 42, ['name']), ['q']);
  });

  it('skips records missing the searchable field', () => {
    const records = [{ name: 'meter one' }, { id: 2 }];

    assert.strictEqual(searchData(records, 'meter', ['name']).length, 1);
  });
});

describe('paginateAndFilter', () => {
  const options = {
    allowedFilters: ['status', 'role'],
    searchableFields: ['name', 'status'],
    sortableFields: ['id', 'name', 'createdAt'],
    defaultSort: { field: 'id', order: 'asc' },
  };

  it('returns defaults with the standard envelope when no params are given', () => {
    const result = paginateAndFilter(makeMeters(), {}, options);

    assert.strictEqual(result.data.length, 20);
    assert.strictEqual(result.pagination.page, 1);
    assert.strictEqual(result.pagination.limit, 20);
    assert.strictEqual(result.pagination.total, 25);
    assert.strictEqual(result.pagination.totalPages, 2);
    assert.strictEqual(result.pagination.hasNext, true);
  });

  it('chains search, filter, sort and pagination', () => {
    const result = paginateAndFilter(
      makeMeters(),
      { q: 'meter 1', status: 'active', sortBy: 'id', sortOrder: 'desc', limit: '2' },
      options
    );

    // 'meter 1' matches ids 1 and 10..19; of those, active ones are 1, 10, 13, 16, 19.
    assert.strictEqual(result.pagination.total, 5);
    assert.strictEqual(result.pagination.totalPages, 3);
    assert.deepStrictEqual(
      result.data.map((meter) => meter.id),
      [19, 16]
    );
  });

  it('reports total after filtering, not the input size', () => {
    const result = paginateAndFilter(makeMeters(), { status: 'active' }, options);

    assert.strictEqual(result.pagination.total, 9);
  });

  it('applies defaultSort when sortBy is absent', () => {
    const meters = makeMeters(5).reverse();
    const result = paginateAndFilter(meters, {}, options);

    assert.deepStrictEqual(
      result.data.map((meter) => meter.id),
      [1, 2, 3, 4, 5]
    );
  });

  it('honours a descending defaultSort order', () => {
    const result = paginateAndFilter(
      makeMeters(5),
      {},
      { ...options, defaultSort: { field: 'id', order: 'desc' } }
    );

    assert.deepStrictEqual(
      result.data.map((meter) => meter.id),
      [5, 4, 3, 2, 1]
    );
  });

  it('ignores filters that are not whitelisted', () => {
    const result = paginateAndFilter(makeMeters(), { name: 'Meter 3' }, options);

    assert.strictEqual(result.pagination.total, 25);
  });

  it('filters by an inclusive createdAt range', () => {
    const result = paginateAndFilter(
      makeMeters(),
      { createdAfter: '2024-01-05T00:00:00.000Z', createdBefore: '2024-01-09T00:00:00.000Z' },
      options
    );

    assert.strictEqual(result.pagination.total, 5);
    assert.deepStrictEqual(
      result.data.map((meter) => meter.id),
      [5, 6, 7, 8, 9]
    );
  });

  it('throws a ValidationError for an unparseable date bound', () => {
    assertValidationError(
      () => paginateAndFilter(makeMeters(), { createdAfter: 'not-a-date' }, options),
      ['createdAfter']
    );

    assertValidationError(
      () =>
        paginateAndFilter(
          makeMeters(),
          { createdAfter: 'nope', createdBefore: 'also-nope' },
          options
        ),
      ['createdAfter', 'createdBefore']
    );
  });

  it('propagates validation errors from every stage', () => {
    assertValidationError(() => paginateAndFilter(makeMeters(), { page: '0' }, options), ['page']);
    assertValidationError(() => paginateAndFilter(makeMeters(), { limit: '101' }, options), [
      'limit',
    ]);
    assertValidationError(() => paginateAndFilter(makeMeters(), { sortBy: 'role' }, options), [
      'sortBy',
    ]);
    assertValidationError(() => paginateAndFilter(makeMeters(), { sortOrder: 'up' }, options), [
      'sortOrder',
    ]);
  });

  it('accepts date-only bounds as well as full timestamps', () => {
    const result = paginateAndFilter(
      makeMeters(),
      { createdAfter: '2024-01-05', createdBefore: '2024-01-09' },
      options
    );

    assert.strictEqual(result.pagination.total, 5);
  });

  it('handles empty data', () => {
    const result = paginateAndFilter([], { q: 'meter', page: '3' }, options);

    assert.deepStrictEqual(result.data, []);
    assert.strictEqual(result.pagination.total, 0);
    assert.strictEqual(result.pagination.totalPages, 0);
  });

  it('is also exported as applyPagination, the name used in the issue description', () => {
    assert.strictEqual(applyPagination, paginateAndFilter);

    const viaAlias = applyPagination(makeMeters(), { limit: '5' }, options);
    assert.strictEqual(viaAlias.data.length, 5);
    assert.strictEqual(viaAlias.pagination.total, 25);
  });
});

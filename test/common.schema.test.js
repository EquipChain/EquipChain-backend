const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  paginationQuerySchema,
  makeListQuerySchema,
  cursorQuerySchema,
  makeCursorListQuerySchema,
} = require('../src/schemas/common.schema');
const { isIsoDateString } = require('../src/utils/pagination');

function issuePaths(result) {
  return result.error.issues.map((issue) => issue.path.join('.'));
}

describe('paginationQuerySchema', () => {
  it('applies defaults for an empty query', () => {
    const result = paginationQuerySchema.safeParse({});

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.data, { page: 1, limit: 20, sortOrder: 'asc' });
  });

  it('coerces numeric strings from the query string', () => {
    const result = paginationQuerySchema.safeParse({ page: '2', limit: '5' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.page, 2);
    assert.strictEqual(result.data.limit, 5);
  });

  it('rejects a limit above the maximum', () => {
    const result = paginationQuerySchema.safeParse({ limit: '101' });

    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(issuePaths(result), ['limit']);
  });

  it('rejects a page below one', () => {
    for (const page of ['0', '-1']) {
      const result = paginationQuerySchema.safeParse({ page });

      assert.strictEqual(result.success, false, `page=${page}`);
      assert.deepStrictEqual(issuePaths(result), ['page']);
    }
  });

  it('rejects non-integer and non-numeric pagination values', () => {
    assert.strictEqual(paginationQuerySchema.safeParse({ page: '1.5' }).success, false);
    assert.strictEqual(paginationQuerySchema.safeParse({ limit: 'abc' }).success, false);
  });

  it('rejects an unknown sort order', () => {
    const result = paginationQuerySchema.safeParse({ sortOrder: 'sideways' });

    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(issuePaths(result), ['sortOrder']);
  });

  it('accepts ISO date-times and plain ISO dates', () => {
    for (const createdAfter of ['2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00Z', '2024-01-01']) {
      const result = paginationQuerySchema.safeParse({ createdAfter });
      assert.strictEqual(result.success, true, `createdAfter=${createdAfter}`);
    }
  });

  it('rejects malformed date bounds', () => {
    for (const createdAfter of ['01/01/2024', 'yesterday', '2024', '']) {
      const result = paginationQuerySchema.safeParse({ createdAfter });
      assert.strictEqual(result.success, false, `createdAfter=${createdAfter}`);
    }
  });

  it('agrees with the utilities on which date bounds are valid', () => {
    // Regression guard: the schema and filterByDateRange share one predicate, so a bound
    // accepted at the edge can never be rejected downstream.
    for (const value of ['2024-01-01', '2024-01-01T00:00:00.000Z', '01/01/2024', 'nope']) {
      assert.strictEqual(
        paginationQuerySchema.safeParse({ createdAfter: value }).success,
        isIsoDateString(value),
        `value=${value}`
      );
    }
  });

  it('rejects an overlong search term', () => {
    const result = paginationQuerySchema.safeParse({ q: 'x'.repeat(201) });

    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(issuePaths(result), ['q']);
  });

  it('strips undeclared query parameters', () => {
    const result = paginationQuerySchema.safeParse({ role: 'admin', 'drop table': '1' });

    assert.strictEqual(result.success, true);
    assert.strictEqual('role' in result.data, false);
    assert.deepStrictEqual(result.data, { page: 1, limit: 20, sortOrder: 'asc' });
  });
});

describe('makeListQuerySchema', () => {
  const schema = makeListQuerySchema({
    sortableFields: ['id', 'createdAt'],
    filters: ['status', 'role'],
  });

  it('keeps the shared pagination defaults', () => {
    const result = schema.safeParse({});

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.page, 1);
    assert.strictEqual(result.data.limit, 20);
  });

  it('accepts declared filters', () => {
    const result = schema.safeParse({ status: 'active', role: 'admin' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.status, 'active');
    assert.strictEqual(result.data.role, 'admin');
  });

  it('still strips filters it does not declare', () => {
    const result = schema.safeParse({ secret: 'value' });

    assert.strictEqual(result.success, true);
    assert.strictEqual('secret' in result.data, false);
  });

  it('accepts a whitelisted sort field', () => {
    const result = schema.safeParse({ sortBy: 'createdAt', sortOrder: 'desc' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.sortBy, 'createdAt');
    assert.strictEqual(result.data.sortOrder, 'desc');
  });

  it('rejects a sort field outside the whitelist', () => {
    const result = schema.safeParse({ sortBy: 'password' });

    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(issuePaths(result), ['sortBy']);
  });

  it('leaves sortBy unconstrained when no sortable fields are declared', () => {
    const result = makeListQuerySchema().safeParse({ sortBy: 'anything' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.sortBy, 'anything');
  });
});

describe('cursorQuerySchema', () => {
  it('defaults to offset mode so existing clients are unaffected', () => {
    const result = cursorQuerySchema.safeParse({});

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.data, { paginate: 'offset', limit: 20, sortOrder: 'asc' });
  });

  it('accepts cursor mode with a forward cursor', () => {
    const result = cursorQuerySchema.safeParse({ paginate: 'cursor', cursor: 'eyJ2IjoxfQ' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.paginate, 'cursor');
    assert.strictEqual(result.data.cursor, 'eyJ2IjoxfQ');
  });

  it('rejects an unknown pagination mode', () => {
    const result = cursorQuerySchema.safeParse({ paginate: 'keyset' });

    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(issuePaths(result), ['paginate']);
  });

  it('rejects cursor and before together', () => {
    const result = cursorQuerySchema.safeParse({ cursor: 'abc', before: 'def' });

    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(issuePaths(result), ['cursor']);
  });

  it('rejects an empty cursor', () => {
    const result = cursorQuerySchema.safeParse({ cursor: '' });

    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(issuePaths(result), ['cursor']);
  });

  it('does not accept page, which has no meaning for keyset paging', () => {
    const result = cursorQuerySchema.safeParse({ page: '2' });

    assert.strictEqual(result.success, true);
    assert.strictEqual('page' in result.data, false);
  });

  it('caps limit at the shared maximum', () => {
    assert.strictEqual(cursorQuerySchema.safeParse({ limit: '101' }).success, false);
    assert.strictEqual(cursorQuerySchema.safeParse({ limit: '100' }).success, true);
  });
});

describe('makeCursorListQuerySchema', () => {
  const schema = makeCursorListQuerySchema({
    sortableFields: ['id', 'createdAt'],
    filters: ['status'],
  });

  it('narrows sortBy and accepts declared filters', () => {
    const result = schema.safeParse({ sortBy: 'createdAt', status: 'active' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.sortBy, 'createdAt');
    assert.strictEqual(result.data.status, 'active');
  });

  it('rejects a sort field outside the whitelist', () => {
    const result = schema.safeParse({ sortBy: 'password' });

    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(issuePaths(result), ['sortBy']);
  });

  it('carries the cursor/before conflict check through extend', () => {
    // Regression guard: Zod 4 keeps refinements across .extend(); on a version that did
    // not, this conflict would slip past validation and only fail inside paginateCursor.
    const result = schema.safeParse({ cursor: 'abc', before: 'def' });

    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(issuePaths(result), ['cursor']);
  });

  it('keeps the cursor-mode defaults', () => {
    const result = schema.safeParse({});

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.paginate, 'offset');
    assert.strictEqual(result.data.limit, 20);
  });
});

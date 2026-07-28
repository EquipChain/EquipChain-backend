const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  ValidationError,
  CURSOR_VERSION,
  encodeCursor,
  decodeCursor,
  paginateCursorForward,
  paginateCursorBackward,
  paginateCursor,
  paginateAndFilterCursor,
  paginateList,
} = require('../src/utils/pagination');

/**
 * Meters with sequential ids and one distinct createdAt each, so a sort on either field
 * produces the same order and a test can assert on ids alone.
 */
function makeMeters(count = 25) {
  return Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    return {
      id,
      name: `Meter ${id}`,
      status: ['active', 'idle', 'faulty'][index % 3],
      createdAt: `2024-01-${String(id).padStart(2, '0')}`,
    };
  });
}

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

const ids = (result) => result.data.map((item) => item.id);

/** Pages forward to exhaustion, returning every id served across all pages. */
function drainForward(data, params) {
  const seen = [];
  let cursor;

  for (let guard = 0; guard < 100; guard += 1) {
    const result = paginateCursorForward(data, { ...params, cursor });
    seen.push(...ids(result));

    if (!result.pagination.hasNext) {
      return seen;
    }
    cursor = result.pagination.nextCursor;
  }

  throw new Error('forward pagination did not terminate');
}

describe('encodeCursor', () => {
  it('encodes an object as URL-safe base64', () => {
    const cursor = encodeCursor({ v: 1, f: 'id', o: 'asc', k: 5, id: 5 });

    assert.strictEqual(typeof cursor, 'string');
    // base64url uses - and _ instead of + and /, and drops the = padding.
    assert.match(cursor, /^[A-Za-z0-9_-]+$/);
  });

  it('round-trips objects, strings and numbers', () => {
    for (const value of [{ v: 1, k: 'a', id: 2 }, 'plain-string', 42, null, [1, 2, 3]]) {
      assert.deepStrictEqual(decodeCursor(encodeCursor(value)), value, JSON.stringify(value));
    }
  });

  it('round-trips values needing URL-safe characters', () => {
    // JSON with these bytes base64-encodes to text containing + and /, which would be
    // mangled in a query string under standard base64.
    const value = { k: 'a?b&c=d/e+f', id: 1 };

    assert.deepStrictEqual(decodeCursor(encodeCursor(value)), value);
  });

  it('throws a TypeError for values JSON cannot represent', () => {
    const circular = {};
    circular.self = circular;

    assert.throws(() => encodeCursor(circular), TypeError);
    assert.throws(() => encodeCursor(undefined), TypeError);
    assert.throws(() => encodeCursor(() => {}), TypeError);
  });
});

describe('decodeCursor', () => {
  it('returns null for malformed input', () => {
    const malformed = [
      undefined,
      null,
      42,
      {},
      '',
      '   ',
      '!!!not-base64!!!',
      // Valid base64url whose payload is not JSON. Buffer.from never throws on bad input —
      // it silently drops out-of-alphabet characters — so JSON.parse is the real gate.
      Buffer.from('not json at all').toString('base64url'),
      Buffer.from('{"unterminated":').toString('base64url'),
    ];

    for (const value of malformed) {
      assert.strictEqual(decodeCursor(value), null, String(value));
    }
  });
});

describe('paginateCursorForward', () => {
  it('returns the first page when no cursor is supplied', () => {
    const result = paginateCursorForward(makeMeters(), { limit: 5, sortBy: 'id' });

    assert.deepStrictEqual(ids(result), [1, 2, 3, 4, 5]);
    assert.strictEqual(result.pagination.limit, 5);
    assert.strictEqual(result.pagination.cursor, null);
    assert.strictEqual(result.pagination.hasNext, true);
    assert.strictEqual(result.pagination.hasPrev, false);
    assert.strictEqual(result.pagination.prevCursor, null);
    assert.ok(result.pagination.nextCursor);
  });

  it('omits total unless it is asked for', () => {
    const data = makeMeters();

    assert.strictEqual('total' in paginateCursorForward(data, { limit: 5 }).pagination, false);
    assert.strictEqual(
      paginateCursorForward(data, { limit: 5, includeTotal: true }).pagination.total,
      25
    );
  });

  it('returns the following page with no overlap', () => {
    const data = makeMeters();
    const first = paginateCursorForward(data, { limit: 5, sortBy: 'id' });
    const second = paginateCursorForward(data, {
      limit: 5,
      sortBy: 'id',
      cursor: first.pagination.nextCursor,
    });

    assert.deepStrictEqual(ids(second), [6, 7, 8, 9, 10]);
    assert.strictEqual(second.pagination.cursor, first.pagination.nextCursor);
    assert.strictEqual(second.pagination.hasPrev, true);
  });

  it('encodes the last item of the page in nextCursor', () => {
    const result = paginateCursorForward(makeMeters(), { limit: 5, sortBy: 'createdAt' });

    assert.deepStrictEqual(decodeCursor(result.pagination.nextCursor), {
      v: CURSOR_VERSION,
      f: 'createdAt',
      o: 'asc',
      k: '2024-01-05',
      id: 5,
    });
  });

  it('walks the whole data set exactly once', () => {
    const data = makeMeters(23);
    const seen = drainForward(data, { limit: 5, sortBy: 'id' });

    // No gaps and no repeats: the union of every page is the data set itself.
    assert.deepStrictEqual(
      seen,
      data.map((item) => item.id)
    );
  });

  it('signals the end of the data with hasNext false and a null nextCursor', () => {
    const data = makeMeters(10);
    const second = paginateCursorForward(data, {
      limit: 5,
      sortBy: 'id',
      cursor: encodeCursor({ v: CURSOR_VERSION, f: 'id', o: 'asc', k: 5, id: 5 }),
    });

    assert.deepStrictEqual(ids(second), [6, 7, 8, 9, 10]);
    assert.strictEqual(second.pagination.hasNext, false);
    assert.strictEqual(second.pagination.nextCursor, null);
  });

  it('returns an empty page for a cursor at the end of the data', () => {
    const data = makeMeters(10);
    const result = paginateCursorForward(data, {
      limit: 5,
      sortBy: 'id',
      cursor: encodeCursor({ v: CURSOR_VERSION, f: 'id', o: 'asc', k: 10, id: 10 }),
    });

    assert.deepStrictEqual(result.data, []);
    assert.strictEqual(result.pagination.hasNext, false);
    assert.strictEqual(result.pagination.nextCursor, null);
    assert.strictEqual(result.pagination.prevCursor, null);
  });

  it('handles an empty data set', () => {
    const result = paginateCursorForward([], { limit: 5, sortBy: 'id' });

    assert.deepStrictEqual(result.data, []);
    assert.strictEqual(result.pagination.hasNext, false);
    assert.strictEqual(result.pagination.hasPrev, false);
    assert.strictEqual(result.pagination.nextCursor, null);
  });

  it('handles a data set that fits in one page', () => {
    const result = paginateCursorForward(makeMeters(3), { limit: 5, sortBy: 'id' });

    assert.deepStrictEqual(ids(result), [1, 2, 3]);
    assert.strictEqual(result.pagination.hasNext, false);
    assert.strictEqual(result.pagination.hasPrev, false);
  });

  it('pages in descending order', () => {
    const data = makeMeters(10);
    const first = paginateCursorForward(data, { limit: 3, sortBy: 'id', sortOrder: 'desc' });
    const second = paginateCursorForward(data, {
      limit: 3,
      sortBy: 'id',
      sortOrder: 'desc',
      cursor: first.pagination.nextCursor,
    });

    assert.deepStrictEqual(ids(first), [10, 9, 8]);
    assert.deepStrictEqual(ids(second), [7, 6, 5]);
  });

  it('sorts by id when sortBy is omitted', () => {
    // Keyset paging needs a total order, so an unsorted request cannot be honoured as-is.
    const shuffled = [{ id: 3 }, { id: 1 }, { id: 2 }];

    assert.deepStrictEqual(ids(paginateCursorForward(shuffled, { limit: 3 })), [1, 2, 3]);
  });

  it('respects a custom idField', () => {
    const data = [
      { readingId: 2, value: 'b' },
      { readingId: 1, value: 'a' },
    ];
    const result = paginateCursorForward(data, { limit: 1, idField: 'readingId' });

    assert.deepStrictEqual(result.data, [{ readingId: 1, value: 'a' }]);
    assert.deepStrictEqual(decodeCursor(result.pagination.nextCursor), {
      v: CURSOR_VERSION,
      f: 'readingId',
      o: 'asc',
      k: 1,
      id: 1,
    });
  });
});

describe('paginateCursorForward tiebreaking', () => {
  it('neither skips nor repeats rows sharing a sort value', () => {
    // The case a single-value cursor gets wrong: with five rows on one timestamp,
    // `WHERE createdAt > k` skips four of them and `>=` re-serves them forever. The id
    // tiebreaker in the cursor is what makes the ordering total.
    const data = [
      { id: 1, createdAt: '2024-01-01' },
      { id: 2, createdAt: '2024-01-02' },
      { id: 3, createdAt: '2024-01-02' },
      { id: 4, createdAt: '2024-01-02' },
      { id: 5, createdAt: '2024-01-02' },
      { id: 6, createdAt: '2024-01-02' },
      { id: 7, createdAt: '2024-01-03' },
    ];

    const seen = drainForward(data, { limit: 2, sortBy: 'createdAt' });

    assert.deepStrictEqual(seen, [1, 2, 3, 4, 5, 6, 7]);
  });

  it('tiebreaks in the same direction as the primary sort', () => {
    const data = [
      { id: 1, createdAt: '2024-01-01' },
      { id: 2, createdAt: '2024-01-01' },
      { id: 3, createdAt: '2024-01-01' },
    ];

    const seen = drainForward(data, { limit: 1, sortBy: 'createdAt', sortOrder: 'desc' });

    assert.deepStrictEqual(seen, [3, 2, 1]);
  });
});

describe('paginateCursorForward stability', () => {
  it('does not drift when rows are inserted between requests', () => {
    // Offset paging would re-serve id 5 here: inserting ahead of the window shifts every
    // later row down by one, so page 2 starts where page 1 ended. A cursor is anchored to
    // a value rather than a count, so the boundary does not move.
    const data = makeMeters(10);
    const first = paginateCursorForward(data, { limit: 5, sortBy: 'id' });
    assert.deepStrictEqual(ids(first), [1, 2, 3, 4, 5]);

    data.unshift({ id: 0, name: 'Meter 0', status: 'active', createdAt: '2024-01-01' });

    const second = paginateCursorForward(data, {
      limit: 5,
      sortBy: 'id',
      cursor: first.pagination.nextCursor,
    });

    assert.deepStrictEqual(ids(second), [6, 7, 8, 9, 10]);
  });

  it('still positions correctly when the cursor row has been deleted', () => {
    // Position is resolved by comparing values, not by locating the anchor row, so a
    // cursor outlives the row it was minted from. An index-based implementation would
    // lose its place here.
    const data = makeMeters(10);
    const first = paginateCursorForward(data, { limit: 5, sortBy: 'id' });

    const remaining = data.filter((item) => item.id !== 5);
    const second = paginateCursorForward(remaining, {
      limit: 5,
      sortBy: 'id',
      cursor: first.pagination.nextCursor,
    });

    assert.deepStrictEqual(ids(second), [6, 7, 8, 9, 10]);
  });
});

describe('paginateCursorBackward', () => {
  it('returns the page immediately before the cursor, in sort order', () => {
    const data = makeMeters(20);
    const result = paginateCursorBackward(data, {
      limit: 5,
      sortBy: 'id',
      before: encodeCursor({ v: CURSOR_VERSION, f: 'id', o: 'asc', k: 11, id: 11 }),
    });

    // The last 5 items before the anchor, not the first 5 of the data set.
    assert.deepStrictEqual(ids(result), [6, 7, 8, 9, 10]);
    assert.strictEqual(result.pagination.hasPrev, true);
    assert.strictEqual(result.pagination.hasNext, true);
  });

  it('round-trips with forward pagination', () => {
    const data = makeMeters(20);
    const first = paginateCursorForward(data, { limit: 5, sortBy: 'id' });
    const second = paginateCursorForward(data, {
      limit: 5,
      sortBy: 'id',
      cursor: first.pagination.nextCursor,
    });
    const back = paginateCursorBackward(data, {
      limit: 5,
      sortBy: 'id',
      before: second.pagination.prevCursor,
    });

    assert.deepStrictEqual(ids(back), ids(first));
  });

  it('returns a short page and hasPrev false at the start of the data', () => {
    const data = makeMeters(20);
    const result = paginateCursorBackward(data, {
      limit: 5,
      sortBy: 'id',
      before: encodeCursor({ v: CURSOR_VERSION, f: 'id', o: 'asc', k: 3, id: 3 }),
    });

    assert.deepStrictEqual(ids(result), [1, 2]);
    assert.strictEqual(result.pagination.hasPrev, false);
    assert.strictEqual(result.pagination.prevCursor, null);
  });

  it('returns an empty page for a cursor at the first item', () => {
    const data = makeMeters(20);
    const result = paginateCursorBackward(data, {
      limit: 5,
      sortBy: 'id',
      before: encodeCursor({ v: CURSOR_VERSION, f: 'id', o: 'asc', k: 1, id: 1 }),
    });

    assert.deepStrictEqual(result.data, []);
    assert.strictEqual(result.pagination.hasPrev, false);
    assert.strictEqual(result.pagination.hasNext, true);
  });

  it('accepts the anchor as cursor as well as before', () => {
    // Issue #25 documents this function as paginateCursorBackward(data, { cursor, limit,
    // sortBy, sortOrder }). Reading only `before` would make that call silently return the
    // last page — wrong output that still looks like a working response.
    const data = makeMeters(12);
    const anchor = encodeCursor({ v: CURSOR_VERSION, f: 'id', o: 'asc', k: 11, id: 11 });

    const viaBefore = paginateCursorBackward(data, { limit: 5, sortBy: 'id', before: anchor });
    const viaCursor = paginateCursorBackward(data, { limit: 5, sortBy: 'id', cursor: anchor });

    assert.deepStrictEqual(ids(viaCursor), [6, 7, 8, 9, 10]);
    assert.deepStrictEqual(ids(viaCursor), ids(viaBefore));
  });

  it('reports a malformed anchor against the parameter that carried it', () => {
    assertValidationError(
      () => paginateCursorBackward(makeMeters(), { sortBy: 'id', before: 'bad' }),
      ['before']
    );
    assertValidationError(
      () => paginateCursorBackward(makeMeters(), { sortBy: 'id', cursor: 'bad' }),
      ['cursor']
    );
  });

  it('returns the final page when no anchor is supplied', () => {
    // "The page before the end" — the mirror of forward paging returning the first page
    // when it has no cursor.
    const result = paginateCursorBackward(makeMeters(12), { limit: 5, sortBy: 'id' });

    assert.deepStrictEqual(ids(result), [8, 9, 10, 11, 12]);
    assert.strictEqual(result.pagination.hasNext, false);
    assert.strictEqual(result.pagination.hasPrev, true);
  });

  it('pages backward in descending order', () => {
    const data = makeMeters(10);
    const result = paginateCursorBackward(data, {
      limit: 3,
      sortBy: 'id',
      sortOrder: 'desc',
      before: encodeCursor({ v: CURSOR_VERSION, f: 'id', o: 'desc', k: 4, id: 4 }),
    });

    // Descending, the rows before id 4 are the higher ids.
    assert.deepStrictEqual(ids(result), [7, 6, 5]);
  });
});

describe('paginateCursor', () => {
  it('dispatches to the backward direction when before is supplied', () => {
    const data = makeMeters(20);
    const result = paginateCursor(data, {
      limit: 5,
      sortBy: 'id',
      before: encodeCursor({ v: CURSOR_VERSION, f: 'id', o: 'asc', k: 11, id: 11 }),
    });

    assert.deepStrictEqual(ids(result), [6, 7, 8, 9, 10]);
  });

  it('rejects cursor and before together', () => {
    const anchor = encodeCursor({ v: CURSOR_VERSION, f: 'id', o: 'asc', k: 5, id: 5 });

    assertValidationError(
      () => paginateCursor(makeMeters(), { sortBy: 'id', cursor: anchor, before: anchor }),
      ['cursor']
    );
  });

  it('rejects a malformed cursor', () => {
    for (const bad of ['not-a-cursor', '!!!', Buffer.from('nope').toString('base64url')]) {
      assertValidationError(
        () => paginateCursor(makeMeters(), { sortBy: 'id', cursor: bad }),
        ['cursor'],
        bad
      );
    }
  });

  it('rejects a malformed before cursor on the before field', () => {
    assertValidationError(
      () => paginateCursor(makeMeters(), { sortBy: 'id', before: 'not-a-cursor' }),
      ['before']
    );
  });

  it('rejects a cursor of the wrong shape or version', () => {
    const wrong = [
      encodeCursor('a bare string'),
      encodeCursor([1, 2, 3]),
      encodeCursor({ f: 'id', o: 'asc', k: 5, id: 5 }),
      encodeCursor({ v: CURSOR_VERSION + 1, f: 'id', o: 'asc', k: 5, id: 5 }),
      encodeCursor({ v: CURSOR_VERSION, f: 'id', o: 'asc' }),
    ];

    for (const bad of wrong) {
      assertValidationError(
        () => paginateCursor(makeMeters(), { sortBy: 'id', cursor: bad }),
        ['cursor'],
        bad
      );
    }
  });

  it('rejects a cursor minted for a different sort', () => {
    // Self-validation in place of a signature: a cursor carries the sort it was issued
    // for, so replaying it against another column fails instead of silently mispaging.
    const cursor = encodeCursor({
      v: CURSOR_VERSION,
      f: 'createdAt',
      o: 'asc',
      k: '2024-01-05',
      id: 5,
    });

    assertValidationError(
      () => paginateCursor(makeMeters(), { sortBy: 'id', cursor }),
      ['cursor']
    );
    assertValidationError(
      () => paginateCursor(makeMeters(), { sortBy: 'createdAt', sortOrder: 'desc', cursor }),
      ['cursor']
    );
  });

  it('rejects an invalid limit and sortOrder', () => {
    assertValidationError(() => paginateCursor(makeMeters(), { limit: '0' }), ['limit']);
    assertValidationError(() => paginateCursor(makeMeters(), { limit: '101' }), ['limit']);
    assertValidationError(() => paginateCursor(makeMeters(), { sortOrder: 'sideways' }), [
      'sortOrder',
    ]);
  });

  it('rejects a sortBy outside the whitelist when one is supplied', () => {
    assertValidationError(
      () => paginateCursor(makeMeters(), { sortBy: 'secret', sortableFields: ['id', 'name'] }),
      ['sortBy']
    );
  });

  it('holds only a caller-supplied sortBy to the whitelist', () => {
    // An endpoint declaring nothing sortable must still be able to page: the idField
    // fallback is this module's own default, not client input, so it cannot be rejected as
    // a bad `sortBy` the caller never sent.
    const result = paginateCursor(makeMeters(6), { limit: 3, sortableFields: [] });

    assert.deepStrictEqual(ids(result), [1, 2, 3]);
  });

  it('validates sortOrder even without a whitelist', () => {
    assertValidationError(
      () => paginateCursor(makeMeters(), { sortOrder: 'sideways' }),
      ['sortOrder']
    );
  });

  it('throws a TypeError when data is not an array', () => {
    assert.throws(() => paginateCursor('nope', { sortBy: 'id' }), TypeError);
  });
});

describe('paginateAndFilterCursor', () => {
  it('applies search, filters and date bounds before paging', () => {
    const result = paginateAndFilterCursor(
      makeMeters(),
      { status: 'active', limit: '3', sortBy: 'id' },
      { allowedFilters: ['status'], sortableFields: ['id', 'name', 'createdAt'] }
    );

    assert.deepStrictEqual(ids(result), [1, 4, 7]);
    assert.strictEqual(result.pagination.hasNext, true);
  });

  it('keeps cursor paging consistent across a filtered set', () => {
    const data = makeMeters();
    const options = { allowedFilters: ['status'], sortableFields: ['id', 'createdAt'] };
    const first = paginateAndFilterCursor(data, { status: 'active', limit: '3' }, options);
    const second = paginateAndFilterCursor(
      data,
      { status: 'active', limit: '3', cursor: first.pagination.nextCursor },
      options
    );

    assert.deepStrictEqual(ids(second), [10, 13, 16]);
  });

  it('does not treat cursor, before or paginate as filters', () => {
    // These are reserved params; leaking them into filterData would match nothing and
    // return an empty page.
    const result = paginateAndFilterCursor(
      makeMeters(),
      { paginate: 'cursor', cursor: undefined, before: undefined, limit: '3' },
      { allowedFilters: ['status'] }
    );

    assert.deepStrictEqual(ids(result), [1, 2, 3]);
  });

  it('narrows the search before paging', () => {
    const result = paginateAndFilterCursor(
      makeMeters(),
      { q: 'meter 1', limit: '100' },
      { searchableFields: ['name'], sortableFields: ['id'] }
    );

    assert.deepStrictEqual(ids(result), [1, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    assert.strictEqual(result.pagination.hasNext, false);
  });

  it('rejects an unsupported sortBy at the whitelist', () => {
    assertValidationError(
      () =>
        paginateAndFilterCursor(
          makeMeters(),
          { sortBy: 'status' },
          { sortableFields: ['id', 'createdAt'] }
        ),
      ['sortBy']
    );
  });
});

describe('paginateList', () => {
  it('defaults to offset pagination when paginate is absent', () => {
    const result = paginateList(makeMeters(), { page: '2', limit: '5' }, {});

    assert.deepStrictEqual(ids(result), [6, 7, 8, 9, 10]);
    assert.strictEqual(result.pagination.page, 2);
    assert.strictEqual(result.pagination.total, 25);
    assert.strictEqual(result.pagination.totalPages, 5);
  });

  it('uses offset pagination for paginate=offset', () => {
    const result = paginateList(makeMeters(), { paginate: 'offset', page: '1', limit: '5' }, {});

    assert.strictEqual(result.pagination.page, 1);
    assert.strictEqual('nextCursor' in result.pagination, false);
  });

  it('uses cursor pagination for paginate=cursor', () => {
    const result = paginateList(
      makeMeters(),
      { paginate: 'cursor', limit: '5', sortBy: 'id' },
      { sortableFields: ['id'] }
    );

    assert.deepStrictEqual(ids(result), [1, 2, 3, 4, 5]);
    assert.strictEqual('page' in result.pagination, false);
    assert.strictEqual('totalPages' in result.pagination, false);
    assert.ok(result.pagination.nextCursor);
  });

  it('rejects an unknown pagination mode', () => {
    assertValidationError(() => paginateList(makeMeters(), { paginate: 'keyset' }, {}), [
      'paginate',
    ]);
  });
});

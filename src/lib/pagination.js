// src/lib/pagination.js
//
// Minimal pagination helper for list endpoints. Issue #11 asks list
// endpoints to leverage issue #17's pagination work, but #17 has not
// landed - this is a small self-contained helper rather than blocking
// on that issue.

const paginate = (items, req) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const start = (page - 1) * limit;

  return {
    data: items.slice(start, start + limit),
    pagination: {
      page,
      limit,
      total: items.length,
      totalPages: Math.max(1, Math.ceil(items.length / limit)),
    },
  };
};

module.exports = { paginate };
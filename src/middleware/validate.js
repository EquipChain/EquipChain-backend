// src/middleware/validate.js
//
// Generic Zod request-body validation middleware factory, per issue
// #11 and issue #8's ask for Zod-based validation (schemas live in
// src/schemas/admin.schema.js since #8 has not landed separately yet).

const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  req.body = result.data;
  return next();
};

module.exports = { validate };
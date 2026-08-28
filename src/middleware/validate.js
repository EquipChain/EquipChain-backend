// src/middleware/validate.js
//
// Generic Zod request validation middleware factory. Supports body, query,
// and params validation with optional XSS sanitization.

const { sanitizeDeep } = require('../utils/sanitize');

/**
 * Generic Zod validation middleware factory.
 *
 * @param {Object} schemas - { body?, query?, params? } Zod schemas
 * @param {Object} options - { sanitize?: boolean } sanitize body strings for XSS
 * @returns {Function} Express middleware
 */
const validate = (schemas = {}, options = {}) => (req, res, next) => {
  const errors = [];
  const sanitizeBody = options.sanitize !== false;

  // Validate body
  if (schemas.body) {
    const result = schemas.body.safeParse(req.body);
    if (!result.success) {
      errors.push(
        ...result.error.issues.map((issue) => ({
          location: 'body',
          path: issue.path.join('.'),
          message: issue.message,
        }))
      );
    } else {
      req.body = sanitizeBody ? sanitizeDeep(result.data) : result.data;
    }
  }

  // Validate query
  if (schemas.query) {
    const result = schemas.query.safeParse(req.query);
    if (!result.success) {
      errors.push(
        ...result.error.issues.map((issue) => ({
          location: 'query',
          path: issue.path.join('.'),
          message: issue.message,
        }))
      );
    } else {
      req.query = result.data;
    }
  }

  // Validate params
  if (schemas.params) {
    const result = schemas.params.safeParse(req.params);
    if (!result.success) {
      errors.push(
        ...result.error.issues.map((issue) => ({
          location: 'params',
          path: issue.path.join('.'),
          message: issue.message,
        }))
      );
    } else {
      req.params = result.data;
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors,
    });
  }

  return next();
};

module.exports = { validate };

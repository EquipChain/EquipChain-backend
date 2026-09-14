// src/middleware/auth.js
//
// JWT authentication middleware. Verifies `Authorization: Bearer <jwt>`
// against the configured secret and attaches the decoded payload to
// req.user for downstream role checks (requireAdmin) and rate-limit tier
// resolution.

const jwt = require('jsonwebtoken');
const config = require('../config');

const authenticate = (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    req.user = jwt.verify(token, config.jwtSecret);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

module.exports = { authenticate };

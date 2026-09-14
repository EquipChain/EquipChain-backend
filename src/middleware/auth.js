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
    // Algorithm pinned: without `algorithms`, jsonwebtoken happily verifies
    // tokens signed with any algorithm the token header declares - the
    // classic algorithm-confusion class (e.g. an HS/none mixup) where a
    // forged token names a lax algorithm and the library obeys. We only ever
    // sign HS256, so only HS256 may verify.
    req.user = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

module.exports = { authenticate };

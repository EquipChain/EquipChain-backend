// src/middleware/auth.js
//
// Minimal JWT authentication middleware. Issue #11 says admin routes
// should be mounted with "authenticate and requireAdmin" middleware and
// depend on auth work from "Issue #5" - but #5 is actually about testing
// infrastructure, not auth, and no other auth-providing issue exists in
// this repo. This is a small, self-contained foundation just sufficient
// to make #11's own verification steps (401 without a token, 403 with a
// non-admin token) work - it is NOT a full auth system (no login/
// register/refresh endpoints, no user store beyond what admin.js manages).
// Replace with real session/auth work when that lands.

const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Server misconfigured: JWT_SECRET is not set.' });
  }

  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    req.user = jwt.verify(token, secret);
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

module.exports = { authenticate };
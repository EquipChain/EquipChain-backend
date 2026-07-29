// src/middleware/requireAdmin.js
//
// Checks req.user.roles (set by the authenticate middleware) for the
// "admin" role. Must run after authenticate - it does not itself verify
// a token exists.

const requireAdmin = (req, res, next) => {
  const roles = req.user?.roles;
  if (!Array.isArray(roles) || !roles.includes('admin')) {
    return res.status(403).json({ error: 'Admin role required.' });
  }
  return next();
};

module.exports = { requireAdmin };
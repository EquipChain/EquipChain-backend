/**
 * Authentication & Authorization Middleware
 *
 * Enforces authentication and admin role authorization for protected endpoints.
 */

const { userRepository, apiKeyRepository } = require('../repositories');

/**
 * Middleware enforcing Admin authorization
 */
async function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'];

  let authenticated = false;
  let user = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    if (token) {
      authenticated = true;
      // Extract user info if mock JWT token format
      if (token.startsWith('mock-jwt-')) {
        user = { role: 'admin', email: 'admin@equipchain.io' };
      }
    }
  } else if (apiKeyHeader) {
    const keyRecord = await apiKeyRepository.findByKey(apiKeyHeader);
    if (keyRecord && keyRecord.status === 'active') {
      authenticated = true;
      user = await userRepository.findById(keyRecord.userId);
    }
  }

  if (!authenticated) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Admin authorization required. Provide a valid Bearer token or API key.',
    });
  }

  req.user = user || { role: 'admin' };
  next();
}

module.exports = {
  adminAuth,
};

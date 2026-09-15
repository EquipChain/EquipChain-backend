'use strict';

// src/routes/index.js
//
// Top-level router: mounts every route module under its documented prefix and
// owns the public system endpoints (/, /health). The admin router is mounted
// behind JWT authentication and the admin-role guard - it was previously only
// reachable through the legacy index.js entry point, leaving the modular app
// without admin routes (and its tests failing with 404s).

const express = require('express');
const { services } = require('../services');
const exportRoutes = require('./exports');
const docsRoutes = require('./docs');
const analyticsRoutes = require('./analytics');
const adminRouter = require('./admin');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { determineTier } = require('../middleware/rateLimiter');
const { RATE_LIMIT_TIERS } = require('../config/rateLimits');

// Deploy identity: GIT_SHA/DEPLOY_TIME come from the deployment environment
// (Docker build args, CI, or ops tooling). Unset locally, they simply don't
// appear - which is preferable to pretending a dev run is a known build.
const DEPLOY_IDENTITY = {
  ...(process.env.GIT_SHA ? { gitSha: process.env.GIT_SHA } : {}),
  ...(process.env.DEPLOY_TIME ? { deployedAt: process.env.DEPLOY_TIME } : {}),
};

const router = express.Router();

// ─── Maintenance mode gate ──────────────────────────────────────────────────

/**
 * Enforce the admin-configurable maintenance kill-switch on the public API
 * surface. Admin/config routes mount BELOW this gate deliberately: if a bad
 * config change or failing dependency is the reason maintenance was enabled,
 * operators must still be able to reach /api/admin to flip it back. Health
 * endpoints also stay available so orchestrators keep an accurate picture.
 *
 * The flag is read per request (not captured at boot) so PATCHing
 * /api/admin/config takes effect immediately, with no restart.
 */
function maintenanceGate(req, res, next) {
  const { configStore } = require('../data/adminStore');
  if (configStore.get().maintenanceMode === true) {
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'Service is under maintenance. Try again later.',
    });
  }
  return next();
}

// Public API surface
router.use('/api/exports', maintenanceGate, exportRoutes);
router.use('/api/analytics', maintenanceGate, analyticsRoutes);
router.use('/api', docsRoutes);

/**
 * GET /api/system/rate-limits
 *
 * Returns the caller's current rate-limit tier, configured limit, remaining
 * requests in the current window, and when the window resets. The tiered
 * rate limiter middleware (applied to /api in src/app.js) runs before this
 * handler and populates req.rateLimit, so the values are always accurate.
 */
/**
 * @openapi
 * /api/system/rate-limits:
 *   get:
 *     summary: Rate-limit status for the caller
 *     description: Returns the caller's resolved tier, configured limit, remaining requests in the current window, and window reset time.
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Current rate-limit status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tier: { type: string, enum: [free, premium, admin, internal] }
 *                 limit: { type: integer }
 *                 remaining: { type: integer }
 *                 resetTime: { type: string, format: date-time }
 *                 retryAfter: { type: integer, description: Seconds until the window resets; present only when capped }
 */
router.get('/api/system/rate-limits', (req, res) => {
  const tier = determineTier(req);
  const tierConfig = RATE_LIMIT_TIERS[tier];

  const limit = req.rateLimit?.limit ?? tierConfig.max;
  const remaining = req.rateLimit?.remaining ?? tierConfig.max;
  const resetAt = req.rateLimit?.resetAt ?? Date.now() + tierConfig.windowMs;
  const resetTime = new Date(resetAt).toISOString();
  const retryAfter = remaining === 0 ? Math.ceil((resetAt - Date.now()) / 1000) : null;

  res.json({
    tier,
    limit,
    remaining,
    resetTime,
    ...(retryAfter !== null && { retryAfter }),
  });
});

// Admin API - JWT + admin role required for every sub-route
router.use('/api/admin', authenticate, requireAdmin, adminRouter);

/**
 * POST /api/auth/logout
 *
 * Server-side sign-out for every authenticated caller, not just admins.
 * Revokes the caller's own token (jti) for its remaining TTL: the token
 * stops working the moment this responds, rather than remaining valid
 * until natural expiry. Admins have had this since the admin logout landed;
 * regular users' "logout" only deleted the client-side token, which is
 * not sign-out - a copied token kept authenticating until expiry.
 *
 * Mounted with authenticate only (no role check): any authenticated
 * identity may revoke itself.
 *
 * @openapi
 * /api/auth/logout:
 *   post:
 *     summary: Revoke the caller's own token
 *     description: |
 *       Server-side sign-out: the presented JWT's id (jti) is denylisted for
 *       the token's remaining lifetime, so the token stops authenticating
 *       immediately. Requires a valid bearer token.
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Token revoked }
 *       401: { description: Missing or invalid bearer token }
 */
router.post('/api/auth/logout', authenticate, async (req, res, next) => {
  try {
    if (req.user && req.user.jti) {
      const { revokeToken } = require('../middleware/auth');
      await revokeToken(req.user.jti, req.user.exp);
      return res.json({ success: true, message: 'Token revoked.' });
    }
    // Authenticated but jti-less (e.g. a legacy token): nothing revocable,
    // and the client should drop the token regardless.
    return res.json({
      success: false,
      message: 'Token has no revocable id (jti); discard it client-side.',
    });
  } catch (err) {
    next(err);
  }
});

// Health check route
/**
 * @openapi
 * /health:
 *   get:
 *     summary: Service health check
 *     tags: [System]
 *     responses:
 *       200: { description: Service health status }
 */
router.get('/health', (req, res) => {
  const healthData = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    ...DEPLOY_IDENTITY,
  };

  // Add queue stats if queue service is available
  if (services.queue) {
    healthData.queue = services.queue.getStats();
  }

  // Add scheduler stats if scheduler service is available
  if (services.scheduler) {
    healthData.scheduler = {
      schedules: services.scheduler.getAllSchedules().length,
      isRunning: services.scheduler.isRunning,
    };
  }

  res.json(healthData);
});

/**
 * @openapi
 * /health/live:
 *   get:
 *     summary: Liveness probe
 *     description: |
 *       Process is up and able to serve requests. Deliberately dependency-free:
 *       if this fails, the container should be restarted, so it must not fail
 *       just because Redis is down.
 *     tags: [System]
 *     responses:
 *       200: { description: Process alive }
 */
router.get('/health/live', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * @openapi
 * /health/ready:
 *   get:
 *     summary: Readiness probe
 *     description: |
 *       Checks whether the service can handle traffic: services initialized
 *       and cache reachable. Unlike liveness, failure here should remove the
 *       instance from load-balancer rotation without restarting it.
 *     tags: [System]
 *     responses:
 *       200: { description: Ready to serve traffic }
 *       503: { description: Not ready - dependencies unavailable }
 */
router.get('/health/ready', async (req, res) => {
  const checks = {};
  let ready = true;

  // Draining? A shutdown signal has flipped this app flag first thing, so
  // the LB removes this instance from rotation before the drain begins.
  if (req.app.get('shuttingDown')) {
    return res.status(503).json({
      status: 'not_ready',
      checks: { draining: true },
      timestamp: new Date().toISOString(),
    });
  }

  // Services initialized?
  checks.servicesInitialized = Boolean(services.scheduler || services.queue);
  if (!checks.servicesInitialized) ready = false;

  // Cache reachable? (memory fallback counts as available)
  try {
    const { cacheService } = require('../services/cache');
    checks.cache = cacheService.isConnected() ? 'ok' : 'unavailable';
    if (!cacheService.isConnected()) ready = false;
  } catch {
    checks.cache = 'unavailable';
    ready = false;
  }

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    checks,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;

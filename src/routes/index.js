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

const router = express.Router();

// Public API surface
router.use('/api/exports', exportRoutes);
router.use('/api/analytics', analyticsRoutes);
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

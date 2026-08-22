require('./src/config/tracing');
const crypto = require('crypto');
const express = require('express');
const { trace } = require('@opentelemetry/api');
const { childLogger } = require('./src/config/logger');
const { authenticate } = require('./src/middleware/auth');
const { requireAdmin } = require('./src/middleware/requireAdmin');
const { rateLimiter, determineTier } = require('./src/middleware/rateLimiter');
const { RATE_LIMIT_TIERS } = require('./src/config/rateLimits');
const adminRouter = require('./src/routes/admin');
const app = express();
app.use(express.json());

// Apply tiered rate limiter globally before all routes
app.use(rateLimiter);
const log = childLogger('http');
const contractId = process.env.CONTRACT_ID || 'CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS';

app.use((req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    activeSpan.setAttribute('correlation.id', correlationId);
  }
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    log.info(
      {
        correlationId,
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        durationMs,
      },
      'request completed'
    );
  });
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

/**
 * GET /api/system/rate-limits
 *
 * Returns the caller's current rate-limit tier, configured limit,
 * remaining requests in the current window, and when the window resets.
 *
 * The rate limiter middleware runs before this handler and populates
 * req.rateLimit, so the values are always accurate.
 */
app.get('/api/system/rate-limits', (req, res) => {
  const tier = determineTier(req);
  const tierConfig = RATE_LIMIT_TIERS[tier];

  // req.rateLimit is set by rateLimiter middleware (remaining may already
  // reflect the cost of this request itself)
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

// Auth challenge - returns a mock JWT token
app.post('/api/auth/challenge', (req, res) => {
  const { wallet } = req.body || {};
  res.json({
    token: `mock-jwt-${wallet || 'anonymous'}-${Date.now()}`,
    expiresIn: 3600,
  });
});

// Protected route - requires Authorization header
app.get('/api/protected', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({
    data: 'Sensitive meter data',
    contract: contractId,
  });
});

// Analytics routes
const analyticsRouter = require('./src/routes/analytics');
app.use('/api/analytics', analyticsRouter);

app.get('/', (req, res) => {
  res.json({
    project: 'Equipchain',
    status: 'Monitoring Meters',
    contract: contractId,
  });
});

app.use('/api/admin', authenticate, requireAdmin, adminRouter);

// Auto-seed sample data in development mode only (not during tests)
if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'production' && process.env.SKIP_SEED !== '1') {
  const { seedReadings } = require('./scripts/seed-readings');
  const count = seedReadings();
  log.info({ readingsSeeded: count }, 'Sample meter readings seeded');
}

if (require.main === module) {
  app.listen(3000, () => log.info('Equipchain API running'));
}

module.exports = app;

require('./src/config/tracing');
const crypto = require('crypto');
const express = require('express');
const { trace } = require('@opentelemetry/api');
const { childLogger } = require('./src/config/logger');
const app = express();
const docsRoutes = require('./src/routes/docs');
const log = childLogger('http');
app.use(express.json());
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

/**
 * @openapi
 * /:
 *   get:
 *     summary: Get project metadata
 *     description: Returns basic project status and the configured Soroban contract ID.
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Project metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 project:
 *                   type: string
 *                   example: Equipchain
 *                 status:
 *                   type: string
 *                   example: Monitoring Meters
 *                 contract:
 *                   type: string
 *                   example: CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS
 */
app.get('/', (req, res) => {
  res.json({
    project: 'Equipchain',
    status: 'Monitoring Meters',
    contract: contractId,
  });
});

app.use(docsRoutes);

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
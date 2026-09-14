'use strict';

// src/app.js
//
// The single canonical Express application for EquipChain.
//
// Historically this repo had TWO divergent apps: the modular src/app.js
// (helmet, correlation logging, analytics/exports/docs routes) and a legacy
// root index.js (auth challenge, admin routes, seeding, no helmet, no JSON
// 404 handler). Routes existed in one but not the other, security middleware
// differed per entry point, and integration tests failed against whichever
// app they did not target (4 of the failures in test/api.integration.test.js
// were exactly this: exports 401/format and admin 400 asserting against the
// legacy app that lacked those routes).
//
// This app now carries the union of both, so every entry point and test sees
// identical behavior:
//   security headers -> CORS -> JSON body parsing (with 413 handled) ->
//   rate limiting (tiered) -> correlation ID + request logging ->
//   system routes (/, /health, /api/health) -> auth challenge/protected ->
//   analytics -> exports -> docs/openapi -> admin (JWT + admin role) ->
//   404 -> error handler.

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { trace } = require('@opentelemetry/api');
const { childLogger } = require('./config/logger');
const config = require('./config');
const routes = require('./routes');
const { rateLimiter } = require('./middleware/rateLimiter');
const { metricsMiddleware, renderMetrics } = require('./middleware/metrics');
const { validate } = require('./middleware/validate');
const { authChallengeSchema } = require('./schemas/validation.schema');
const { sanitizeForLogging, sanitize } = require('./utils/sanitize');

const app = express();
const log = childLogger('http');
app.disable('x-powered-by');

// ─── Metrics ─────────────────────────────────────────────────────────────────

// Mounted first so durations cover every downstream middleware (security,
// parsing, rate limiting, routing). The route label is taken at response
// time, when req.route is populated, keeping label cardinality bounded.
app.use(metricsMiddleware);

// Prometheus scrape endpoint. Open by default (cluster-internal convention);
// set METRICS_TOKEN to require `Authorization: Bearer <token>` from scrapers
// when the port is exposed more broadly.
app.get('/metrics', (req, res) => {
  if (config.metricsToken) {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || token !== config.metricsToken) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
  }
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.end(renderMetrics());
});

// ─── Security & parsing ──────────────────────────────────────────────────────

app.use(
  helmet({
    // This service serves JSON APIs and Swagger UI; it does not serve
    // arbitrary HTML, so a strict CSP costs nothing and defends in depth
    // against any future HTML-rendering regression (e.g. an error page
    // reflecting user input).
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"], // swagger-ui injects inline styles
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
      },
    },
    // HSTS only matters over TLS; harmless locally, correct behind a TLS
    // terminating proxy in production.
    strictTransportSecurity: { maxAge: 15552000, includeSubDomains: true },
    // APIs are consumed cross-origin by the dashboard via fetch/XHR, which
    // is not subject to frame-ancestors; keep the default DENY framing.
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-site' },
  })
);
app.use(
  cors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id', 'x-api-key', 'x-role'],
    maxAge: 86400,
  })
);

// Ensure Content-Type is application/json for all API responses
app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function (data) {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
    }
    return originalJson.call(this, data);
  };
  next();
});

// Body parsing with size limits; PayloadTooLarge becomes a JSON 413 response
const jsonParser = express.json({ limit: config.maxBodySize });
app.use(jsonParser);
app.use(express.urlencoded({ extended: true, limit: config.maxBodySize }));
app.use('/api', rateLimiter);

// ─── Correlation ID + request logging ────────────────────────────────────────

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
        url: sanitizeForLogging(req.originalUrl),
        status: res.statusCode,
        durationMs,
      },
      'request completed'
    );
  });

  next();
});

// ─── Router (system, analytics, exports, docs, admin) ────────────────────────

app.use('/', routes);

// ─── Legacy-compatible top-level endpoints ───────────────────────────────────

// Root route with project info
/**
 * @openapi
 * /:
 *   get:
 *     summary: Project information
 *     tags: [System]
 *     responses:
 *       200: { description: Basic project metadata }
 */
app.get('/', (req, res) => {
  res.json({
    project: 'Equipchain',
    status: 'Monitoring Meters',
    contract: config.contractId,
  });
});

/**
 * @openapi
 * /api/health:
 *   get:
 *     summary: Health check (legacy path)
 *     description: Docker/compose healthchecks and legacy clients probe this path.
 *     tags: [System]
 *     responses:
 *       200: { description: Service health status }
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

/**
 * @openapi
 * /api/auth/challenge:
 *   post:
 *     summary: Wallet auth challenge
 *     description: Returns a mock JWT for the given wallet (development auth flow).
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               wallet: { type: string }
 *     responses:
 *       200: { description: Challenge token issued }
 *       400: { description: Validation failed }
 */
app.post('/api/auth/challenge', validate(authChallengeSchema), (req, res) => {
  const { wallet } = req.body || {};
  res.json({
    token: `mock-jwt-${wallet || 'anonymous'}-${Date.now()}`,
    expiresIn: 3600,
  });
});

/**
 * @openapi
 * /api/protected:
 *   get:
 *     summary: Protected sample route
 *     description: Requires a Bearer token; returns sensitive sample data.
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Authorized payload }
 *       401: { description: Missing or invalid bearer token }
 */
app.get('/api/protected', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({
    data: 'Sensitive meter data',
    contract: config.contractId,
  });
});

// ─── 404 handler ─────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: sanitize(`Cannot ${req.method} ${req.originalUrl}`),
  });
});

// ─── Error handler ───────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Body-parser errors: report the client's mistake precisely (413/400)
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Payload Too Large',
      message: `Request body exceeds the ${config.maxBodySize} limit`,
    });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Request body is not valid JSON',
    });
  }

  log.error(
    {
      correlationId: req.correlationId,
      error: sanitizeForLogging(err.message),
      stack: err.stack,
    },
    'request error'
  );

  // Structured ValidationError (400) carries a machine-readable details
  // array - surface it verbatim so clients can correct their input.
  if (err.name === 'ValidationError' && Array.isArray(err.details)) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.details,
    });
  }

  const status = err.status || err.statusCode || 500;
  const isClientError = status >= 400 && status < 500;

  res.status(status).json({
    error: err.name || 'Internal Server Error',
    // Client errors are the caller's fault - the message is actionable and
    // safe. For 500s the message may contain internals (driver errors, file
    // paths, queries), so it never leaves the server regardless of env; the
    // correlation ID in the response links the client to the server log.
    message: isClientError
      ? sanitize(err.message)
      : 'An error occurred. Reference: ' + (req.correlationId || 'unknown'),
  });
});

module.exports = app;

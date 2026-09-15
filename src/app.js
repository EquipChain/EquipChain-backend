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
const compression = require('compression');
const jwt = require('jsonwebtoken');
const { trace } = require('@opentelemetry/api');
const { childLogger } = require('./config/logger');
const config = require('./config');
const routes = require('./routes');
const { rateLimiter } = require('./middleware/rateLimiter');
const { metricsMiddleware, renderMetrics } = require('./middleware/metrics');
const { validate } = require('./middleware/validate');
const { authChallengeSchema } = require('./schemas/validation.schema');
const { authenticate } = require('./middleware/auth');
const { sanitizeForLogging, sanitize, stripPrototypeKeys, sanitizeHeaderValue } = require('./utils/sanitize');

const app = express();
const log = childLogger('http');
app.disable('x-powered-by');

// Reverse-proxy awareness. Default false: Express then ignores
// X-Forwarded-* headers, which is the safe posture for direct exposure (a
// client could otherwise spoof its IP to evade rate limits). Operators
// running behind nginx/ALB/Cloudflare set TRUST_PROXY=true (or a hop count
// / subnet spec) so req.ip resolves to the real client address and per-IP
// rate limiting throttles clients individually instead of collectively.
app.set('trust proxy', config.trustProxy);

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
    allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id', 'x-api-key'],
    maxAge: 86400,
  })
);

// Response compression for compressible types (JSON analytics payloads, CSV
// and NDJSON exports). Meter-reading data is highly repetitive, so gzip
// shrinks export payloads by an order of magnitude - directly proportional
// to mobile-bandwidth transfer time for fleet operators. Threshold skips
// tiny bodies where compression overhead exceeds savings; the default filter
// respects clients' Accept-Encoding and never compresses already-compressed
// content types.
app.use(compression({ threshold: 1024 }));

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

// Body parsing with size limits; PayloadTooLarge becomes a JSON 413 response.
// A follow-up middleware strips prototype-pollution keys (__proto__/
// constructor/prototype) AFTER body-parser runs - running in the parser's
// verify hook is pointless because body-parser overwrites req.body with its
// own parse afterwards. Stripping post-parse guarantees no route or merge
// helper ever sees a pollution payload: a single naive deep-merge of a
// client body otherwise hands attackers a path to rewrite process defaults.
const jsonParser = express.json({ limit: config.maxBodySize });
app.use(jsonParser);
app.use(express.urlencoded({ extended: true, limit: config.maxBodySize }));
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = stripPrototypeKeys(req.body);
  }
  next();
});
app.use('/api', rateLimiter);

// Dedicated strict limiter on the token-minting endpoint. Token forgery by
// brute force is a different threat from API scraping: the cost of a guess
// is a credential, not a data row, so the ceiling must be far lower than
// any data-serving tier. Keyed per IP (challenge clients pre-auth are
// anonymous); 5 attempts/minute breaks online guessing without affecting
// normal logins, and composes with the tier limiter above.
const { createRateLimiter } = require('./middleware/rateLimiter');
app.use(
  '/api/auth/challenge',
  createRateLimiter({
    tierOverride: 'free',
    keyPrefix: 'authchallenge',
    windowMs: 60_000,
    max: 5,
    message: 'Too many authentication attempts. Try again in a minute.',
  })
);

// ─── Correlation ID + request logging ────────────────────────────────────────

app.use((req, res, next) => {
  // Client-supplied correlation IDs are honored for trace continuity but
  // MUST be sanitized before they are echoed into a response header and
  // written to logs: unsanitized, the header is an injection vector (a
  // crafted value lands in every downstream system that trusts it) and an
  // unbounded header bloats both the response and every log line.
  // removeControlChars strips CR/LF (header smuggling) and other control
  // bytes; 128 chars is generous for UUIDs and human trace IDs.
  const rawCorrelationId = req.headers['x-correlation-id'];
  const correlationId =
    typeof rawCorrelationId === 'string' && rawCorrelationId.length > 0
      ? sanitizeHeaderValue(rawCorrelationId).slice(0, 128) || crypto.randomUUID()
      : crypto.randomUUID();
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
 *     description: |
 *       Mints a real JWT for the given wallet address (HS256, same secret as
 *       every authenticated route). Disabled in production unless
 *       ENABLE_DEV_CHALLENGE=true, because it grants tokens without proving
 *       wallet ownership; the production flow is signature verification,
 *       which layers onto this endpoint.
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
 *       403: { description: Disabled in production (default) }
 */
app.post('/api/auth/challenge', validate(authChallengeSchema), (req, res) => {
  if (config.isProduction && !config.enableDevChallenge) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Dev challenge is disabled in production.',
    });
  }
  const { wallet } = req.body || {};
  // Real signed token: verifies against config.jwtSecret like every other
  // route, carries the wallet as `sub`, a unique jti (so it can be revoked),
  // and an explicit dev_challenge flag so downstream authorization can
  // treat these tokens differently.
  const token = jwt.sign(
    {
      sub: wallet || 'anonymous',
      roles: ['user'],
      dev_challenge: true,
      jti: crypto.randomUUID(),
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn, algorithm: 'HS256' }
  );
  res.json({ token, expiresIn: 3600 });
});

/**
 * @openapi
 * /api/protected:
 *   get:
 *     summary: Protected sample route
 *     description: Requires a valid signed JWT; returns sample data.
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Authorized payload }
 *       401: { description: Missing or invalid bearer token }
 */
app.get('/api/protected', authenticate, (req, res) => {
  res.json({
    data: 'Sensitive meter data',
    contract: config.contractId,
    user: req.user.sub,
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

/**
 * Central error serializer. Exported so tests and additional mounts reuse
 * the exact same status/message/header semantics as the app pipeline.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
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
  // Dependency failures (503) are safe to describe: they say WHICH
  // dependency is down and nothing about internals, and the retryable
  // status is the whole point - clients and LBs act on 503 differently
  // than on 500.
  const isDependencyError = err.name === 'DependencyUnavailableError';

  // Retryable dependency failures advertise Retry-After so clients back
  // off instead of hammering a struggling dependency.
  if (status === 503) {
    res.setHeader('Retry-After', 5);
  }

  res.status(status).json({
    error: err.name || 'Internal Server Error',
    // Client errors are the caller's fault - the message is actionable and
    // safe. Dependency errors get a fixed, dependency-shaped message. For
    // 500s the message may contain internals (driver errors, file paths,
    // queries), so it never leaves the server regardless of env; the
    // correlation ID in the response links the client to the server log.
    message: isClientError
      ? sanitize(err.message)
      : isDependencyError
        ? 'A required dependency is temporarily unavailable. Retry shortly.'
        : 'An error occurred. Reference: ' + (req.correlationId || 'unknown'),
  });
}

app.use(errorHandler);

module.exports = app;
module.exports.errorHandler = errorHandler;

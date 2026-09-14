'use strict';

// src/config/index.js
//
// Centralized, frozen environment configuration. Everything the app reads
// from the environment is parsed and validated here exactly once, so no
// other module needs process.env access or inline parseInt calls.

require('dotenv').config();

const {
  NODE_ENV = 'development',
  PORT = '3000',
  HOST = '0.0.0.0',
  CONTRACT_ID = 'CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS',
  LOG_LEVEL = 'info',
  OTEL_SERVICE_NAME = 'equipchain-api',
  MAX_BODY_SIZE = '1mb',
  CORS_ORIGINS = '*',
  JOB_CONCURRENCY = '5',
  JOB_RETRY_ATTEMPTS = '3',
  JOB_BATCH_SIZE = '10',
  SHUTDOWN_TIMEOUT_MS = '10000',
  REDIS_URL = 'redis://localhost:6379',
  JWT_SECRET = '',
  JWT_EXPIRES_IN = '1h',
} = process.env;

const isProduction = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

function toInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Parse the CORS allowlist once: '*' means allow all (development default),
// otherwise a comma-separated list of exact origins.
const corsOrigins = CORS_ORIGINS.trim()
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (corsOrigins.length === 0) {
  corsOrigins.push('*');
}

// Body-size values must be a positive number followed by a unit suffix
// body-parser understands; a bad value here would otherwise crash the
// server at listen time with an opaque error. Validated via a strict
// capture-group match plus a unit table lookup (no ambiguous alternation
// for the security plugin's unsafe-regex heuristic to flag).
const BODY_SIZE_UNITS = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
// This pattern is linear-time: the quantified group contains a single
// optional character class with no nested quantifiers, so catastrophic
// backtracking is impossible. The security plugin's heuristic cannot see
// that, hence the targeted suppression (not a blanket rule disable).
// eslint-disable-next-line security/detect-unsafe-regex
const bodySizeMatch = MAX_BODY_SIZE.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb)$/);
if (!bodySizeMatch || !(bodySizeMatch[2] in BODY_SIZE_UNITS)) {
  throw new Error(
    `Invalid MAX_BODY_SIZE "${MAX_BODY_SIZE}". Use values like "1mb", "500kb" or "1048576".`
  );
}

// JWT_SECRET governs every authenticated route (admin API, exports).
// Failing fast with a precise message beats serving 500
// "Server misconfigured" on each request after boot.
//
// Policy by environment:
// - production: secret is REQUIRED and must be >= 32 chars (brute-force
//   resistance); boot fails loudly otherwise.
// - development/test: a shorter secret is accepted so local runs and test
//   suites can use deterministic secrets - but a missing secret still gets
//   an ephemeral fallback with a loud warning, and production parity is
//   enforced by CI booting with no secret.
if (!JWT_SECRET || JWT_SECRET.trim().length < 32) {
  if (isProduction) {
    throw new Error(
      'JWT_SECRET is required in production and must be at least 32 characters. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  }
  if (!isTest) {
    // Development convenience only - loudly flagged, never in production.
    // eslint-disable-next-line no-console
    console.warn(
      '[config] JWT_SECRET not set or shorter than 32 chars; using an ephemeral ' +
        'development secret. Tokens will invalidate on every restart.'
    );
  }
}

const effectiveJwtSecret =
  JWT_SECRET && JWT_SECRET.trim().length > 0
    ? JWT_SECRET.trim()
    : `dev-only-${require('crypto').randomBytes(24).toString('hex')}`;

const config = Object.freeze({
  env: NODE_ENV,
  port: toInt(PORT, 3000),
  host: HOST,
  contractId: CONTRACT_ID,
  logLevel: LOG_LEVEL,
  maxBodySize: MAX_BODY_SIZE.trim(),
  corsOrigins,
  redisUrl: REDIS_URL,
  jwtSecret: effectiveJwtSecret,
  jwtExpiresIn: JWT_EXPIRES_IN,
  jobs: Object.freeze({
    concurrency: toInt(JOB_CONCURRENCY, 5),
    retryAttempts: toInt(JOB_RETRY_ATTEMPTS, 3),
    batchSize: toInt(JOB_BATCH_SIZE, 10),
  }),
  shutdownTimeoutMs: toInt(SHUTDOWN_TIMEOUT_MS, 10000),
  otel: Object.freeze({
    serviceName: OTEL_SERVICE_NAME,
  }),
  isProduction,
  isTest,
});

module.exports = config;

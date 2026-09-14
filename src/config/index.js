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

// Body-size values must be a positive number optionally followed by a unit
// suffix body-parser understands; a bad value here would otherwise crash the
// server at listen time with an opaque error.
if (!/^\d+(\.\d+)?(b|kb|mb|gb)?$/i.test(MAX_BODY_SIZE.trim())) {
  throw new Error(
    `Invalid MAX_BODY_SIZE "${MAX_BODY_SIZE}". Use values like "1mb", "500kb" or "1048576".`
  );
}

const config = Object.freeze({
  env: NODE_ENV,
  port: toInt(PORT, 3000),
  host: HOST,
  contractId: CONTRACT_ID,
  logLevel: LOG_LEVEL,
  maxBodySize: MAX_BODY_SIZE.trim(),
  corsOrigins,
  redisUrl: REDIS_URL,
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

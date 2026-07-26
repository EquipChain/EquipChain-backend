require('dotenv').config();

const {
  NODE_ENV = 'development',
  PORT = '3000',
  CONTRACT_ID = 'CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS',
  LOG_LEVEL = 'info',
  OTEL_SERVICE_NAME = 'equipchain-api',
  MAX_BODY_SIZE = '1mb',
} = process.env;

// Validate required environment variables for production
const isProduction = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

if (isProduction) {
  // Add any production-specific required variables here
  // For example: JWT_SECRET, DATABASE_URL, etc.
  // Currently no additional required variables for this project
}

const config = Object.freeze({
  env: NODE_ENV,
  port: parseInt(PORT, 10),
  contractId: CONTRACT_ID,
  logLevel: LOG_LEVEL,
  maxBodySize: MAX_BODY_SIZE,
  otel: {
    serviceName: OTEL_SERVICE_NAME,
  },
  isProduction,
  isTest,
});

module.exports = config;

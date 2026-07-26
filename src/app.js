const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { trace } = require('@opentelemetry/api');
const { childLogger } = require('./config/logger');
const config = require('./config');
const routes = require('./routes');
const { sanitizeForLogging, sanitize } = require('./utils/sanitize');

const app = express();
const log = childLogger('http');

// Security middleware
app.use(helmet());
app.use(cors());

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

// Body parsing middleware with size limits
app.use(express.json({ limit: config.maxBodySize }));
app.use(express.urlencoded({ extended: true, limit: config.maxBodySize }));

// Correlation ID and request logging middleware
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

// Mount routes
app.use('/', routes);

// Root route with project info
app.get('/', (req, res) => {
  res.json({
    project: 'Equipchain',
    status: 'Monitoring Meters',
    contract: config.contractId,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: sanitize(`Cannot ${req.method} ${req.originalUrl}`),
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  log.error(
    {
      correlationId: req.correlationId,
      error: sanitizeForLogging(err.message),
      stack: err.stack,
    },
    'request error'
  );

  res.status(err.status || 500).json({
    error: err.name || 'Internal Server Error',
    message: config.isProduction ? 'An error occurred' : sanitize(err.message),
  });
});

module.exports = app;

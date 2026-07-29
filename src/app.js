const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { trace } = require('@opentelemetry/api');
const { childLogger } = require('./config/logger');
const config = require('./config');
const routes = require('./routes');

const app = express();
const log = childLogger('http');

// Security middleware
app.use(cors());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
        url: req.originalUrl,
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
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  log.error(
    {
      correlationId: req.correlationId,
      error: err.message,
      stack: err.stack,
    },
    'request error'
  );

  res.status(err.status || 500).json({
    error: err.name || 'Internal Server Error',
    message: config.isProduction ? 'An error occurred' : err.message,
  });
});

module.exports = app;

require('./src/config/tracing');

const crypto = require('crypto');
const express = require('express');
const { trace } = require('@opentelemetry/api');
const { childLogger } = require('./src/config/logger');

const app = express();
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

app.get('/', (req, res) => {
  res.json({
    project: 'Equipchain',
    status: 'Monitoring Meters',
    contract: contractId,
  });
});

app.use('/api/admin', authenticate, requireAdmin, adminRouter);

if (require.main === module) {
  app.listen(3000, () => log.info('Equipchain API running'));
}
module.exports = app;
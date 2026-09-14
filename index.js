'use strict';

// index.js
//
// Backward-compatible entry point. The application itself lives in src/app.js;
// this file exists so `node index.js` (package.json start script, Docker CMD,
// platform start commands) and `require('./index')` from legacy tests keep
// working against the single canonical app. Run `node src/server.js` for the
// full server with WebSocket support.

const app = require('./src/app');

// Development convenience: seed sample meter readings so analytics endpoints
// have data immediately. Never in test (deterministic tests) or production
// (no surprise data), matching the SKIP_SEED escape hatch in docker-compose.
if (
  process.env.NODE_ENV !== 'test' &&
  process.env.NODE_ENV !== 'production' &&
  process.env.SKIP_SEED !== '1'
) {
  const { seedReadings } = require('./scripts/seed-readings');
  const count = seedReadings();
  const { childLogger } = require('./src/config/logger');
  childLogger('seed').info({ readingsSeeded: count }, 'Sample meter readings seeded');
}

if (require.main === module) {
  const config = require('./src/config');
  const { childLogger } = require('./src/config/logger');
  const log = childLogger('server');

  const server = app.listen(config.port, config.host, () => {
    log.info(
      { port: config.port, env: config.env, contractId: config.contractId },
      'Equipchain API server started'
    );
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      log.error({ port: config.port }, 'Port already in use');
    } else {
      log.error({ error }, 'Server error');
    }
    process.exit(1);
  });
}

module.exports = app;

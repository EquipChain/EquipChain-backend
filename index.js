'use strict';

// index.js
//
// Thin compatibility entry point. The real server lives in src/server.js:
// socket.io wiring, service initialization (cache/queue/scheduler/WS),
// socket timeouts, the retention sweeper, and the graceful shutdown path
// all live there. Running the app directly with app.listen() here - as this
// file once did - produced a degraded server that looked identical but had
// NO background services and NO graceful shutdown; it is also the image's
// CMD, so containers would boot forever failing /health/ready (services
// never initialized).
//
// Requiring this file (tests do) still yields the Express app.
// Running `node index.js` now boots the full server via startServer().

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
  const { startServer } = require('./src/server');
  startServer();
}

module.exports = app;

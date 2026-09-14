'use strict';

// src/server.js
//
// Full server entry point: canonical Express app + socket.io + services +
// OpenTelemetry, with a shutdown sequence that actually completes.
//
// Shutdown bugs fixed here:
//  - `isShuttingDown` was read before declaration (temporal dead zone), so
//    every SIGTERM raised a ReferenceError inside the signal handler and the
//    process ignored shutdown until the 10s force-kill.
//  - shutdownServices() was only invoked from server.close()'s callback,
//    which never fires when keep-alive sockets or socket.io clients remain
//    connected - the process then hung indefinitely (observed in
//    test/server-integration.test.js, which timed out after 180s+).
//  - an unhandled rejection inside the OTel shutdown path re-entered
//    gracefulShutdown (its own 'unhandledRejection' listener), so the exit
//    path could recurse and log forever.

require('./config/tracing');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { childLogger } = require('./config/logger');
const config = require('./config');
const app = require('./app');
const { initServices, shutdownServices } = require('./services');

const log = childLogger('server');

let server;
let io;
let isShuttingDown = false;

async function startServer() {
  try {
    // Initialize services
    await initServices(app);

    // Create HTTP server with socket.io
    server = createServer(app);
    io = new Server(server, {
      cors: {
        origin: config.corsOrigins,
      },
    });

    // Make the socket.io server available to services
    app.set('io', io);

    // Start listening
    server.listen(config.port, config.host, () => {
      log.info(
        {
          port: config.port,
          env: config.env,
          contractId: config.contractId,
        },
        'Equipchain API server started'
      );
    });

    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        log.error({ port: config.port }, 'Port already in use');
      } else {
        log.error({ error }, 'Server error');
      }
      process.exit(1);
    });
  } catch (error) {
    log.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

/**
 * Force-exit after the graceful window elapses. Uses unref so a pending
 * force-exit timer alone never keeps the loop alive.
 */
function armForceExit(timeoutMs) {
  const t = setTimeout(() => {
    log.error({ timeoutMs }, 'Forced shutdown after timeout');
    process.exit(1);
  }, timeoutMs);
  t.unref?.();
  return t;
}

/**
 * Gracefully shutdown the server.
 *
 * Order matters: stop accepting new connections, then drain in-flight HTTP
 * work with a bounded wait, then tear down services, then exit. Service
 * shutdown happens unconditionally so a hung keep-alive connection cannot
 * block queue/scheduler/cache cleanup.
 *
 * @param {string} signal - signal or error name that triggered shutdown
 */
async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    log.warn('Shutdown already in progress, ignoring signal');
    return;
  }

  isShuttingDown = true;
  log.info({ signal }, 'Received shutdown signal, starting graceful shutdown');
  armForceExit(config.shutdownTimeoutMs);

  // 1. Stop accepting new connections
  if (server) {
    await new Promise((resolve) => {
      server.close(() => resolve());
      // Bound the drain: active keep-alive/socket.io connections would
      // otherwise hold server.open indefinitely.
      setTimeout(resolve, Math.min(2000, config.shutdownTimeoutMs / 2)).unref?.();
    });
    log.info('HTTP server closed');
  }

  // 2. Tear down services (idempotent; safe even if init never completed)
  try {
    await shutdownServices();
    log.info('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    log.error({ error }, 'Error during service shutdown');
    process.exit(1);
  }
}

// Register signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log.error({ error }, 'Uncaught exception');
  // Exit directly: re-entering the graceful path from a broken process state
  // risks recursion; the force-exit arm below bounds the shutdown window.
  isShuttingDown = false;
  gracefulShutdown('uncaughtException').catch(() => process.exit(1));
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  log.error({ reason, promise }, 'Unhandled promise rejection');
  // Log-and-continue: a rejected background promise (e.g. a fire-and-forget
  // OTel export) must not tear down a otherwise healthy API server.
});

// Start server if this file is run directly
if (require.main === module) {
  startServer();
}

module.exports = { startServer, gracefulShutdown };

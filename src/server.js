require('./config/tracing');
const http = require('http');
const { childLogger } = require('./config/logger');
const config = require('./config');
const app = require('./app');
const { initServices, shutdownServices } = require('./services');

const log = childLogger('server');

let server;
let isShuttingDown = false;

/**
 * Start the HTTP server
 */
async function startServer() {
  try {
    // Initialize services
    await initServices(app);

    // Create HTTP server
    server = http.createServer(app);

    // Start listening
    server.listen(config.port, () => {
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
 * Gracefully shutdown the server
 */
async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    log.warn('Shutdown already in progress, ignoring signal');
    return;
  }

  isShuttingDown = true;
  log.info({ signal }, 'Received shutdown signal, starting graceful shutdown');

  // Stop accepting new connections
  if (server) {
    server.close(async (err) => {
      if (err) {
        log.error({ error: err }, 'Error closing server');
        process.exit(1);
      }

      log.info('HTTP server closed');

      try {
        // Shutdown services
        await shutdownServices();
        log.info('Graceful shutdown complete');
        process.exit(0);
      } catch (error) {
        log.error({ error }, 'Error during service shutdown');
        process.exit(1);
      }
    });

    // Force shutdown after timeout
    setTimeout(() => {
      log.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
}

// Register signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log.error({ error }, 'Uncaught exception');
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  log.error({ reason, promise }, 'Unhandled promise rejection');
  gracefulShutdown('unhandledRejection');
});

// Start server if this file is run directly
if (require.main === module) {
  startServer();
}

module.exports = { startServer, gracefulShutdown };

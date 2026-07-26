const { childLogger } = require('../config/logger');
const log = childLogger('services');

// Service registry to track initialized services
const services = {
  cache: null,
  queue: null,
  eventListener: null,
  websocket: null,
};

/**
 * Initialize all services in the correct dependency order
 * @param {Object} app - Express application instance
 */
async function initServices(app) {
  try {
    log.info('Initializing services...');

    // Initialize cache service (if implemented)
    // services.cache = await initCache();
    // log.info('Cache service initialized');

    // Initialize queue service (if implemented)
    // services.queue = await initQueue();
    // log.info('Queue service initialized');

    // Initialize event listener (if implemented)
    // services.eventListener = await initEventListener();
    // log.info('Event listener initialized');

    // Initialize WebSocket (if implemented)
    // services.websocket = await initWebSocket(app);
    // log.info('WebSocket initialized');

    log.info('All services initialized successfully');
  } catch (error) {
    log.error({ error }, 'Failed to initialize services');
    throw error;
  }
}

/**
 * Gracefully shutdown all services
 */
async function shutdownServices() {
  try {
    log.info('Shutting down services...');

    // Shutdown services in reverse dependency order
    if (services.websocket) {
      await services.websocket.close();
      log.info('WebSocket shutdown complete');
    }

    if (services.eventListener) {
      await services.eventListener.stop();
      log.info('Event listener shutdown complete');
    }

    if (services.queue) {
      await services.queue.close();
      log.info('Queue shutdown complete');
    }

    if (services.cache) {
      await services.cache.quit();
      log.info('Cache shutdown complete');
    }

    log.info('All services shutdown complete');
  } catch (error) {
    log.error({ error }, 'Error during service shutdown');
    throw error;
  }
}

module.exports = {
  initServices,
  shutdownServices,
  services,
};

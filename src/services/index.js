const { childLogger } = require('../config/logger');
const { queue, Priority } = require('./queue');
const { scheduler } = require('./scheduler');
const billingHandler = require('../jobs/billing.job');
const reportsHandler = require('../jobs/reports.job');
const syncHandler = require('../jobs/sync.job');
const webhookRetryHandler = require('../jobs/webhookRetry.job');
const cacheWarmHandler = require('../jobs/cacheWarm.job');

const log = childLogger('services');

// Service registry to track initialized services
const services = {
  cache: null,
  queue: null,
  scheduler: null,
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

    // Initialize queue service
    await initQueue();
    log.info('Queue service initialized');

    // Initialize scheduler service
    await initScheduler();
    log.info('Scheduler service initialized');

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
 * Initialize queue service and register job handlers
 */
async function initQueue() {
  // Register job handlers
  queue.registerHandler('billing', billingHandler);
  queue.registerHandler('reports', reportsHandler);
  queue.registerHandler('sync', syncHandler);
  queue.registerHandler('webhookRetry', webhookRetryHandler);
  queue.registerHandler('cacheWarm', cacheWarmHandler);

  // Start processing jobs
  queue.start();

  services.queue = queue;
}

/**
 * Initialize scheduler service and register recurring jobs
 */
async function initScheduler() {
  // Schedule recurring jobs (examples - adjust intervals as needed)
  
  // Billing job - runs every hour
  scheduler.schedule('billing-hourly', '0 * * * *', async () => {
    const period = new Date().toISOString().slice(0, 7); // YYYY-MM
    queue.add('billing', { period });
  });

  // Daily reports - runs every day at midnight
  scheduler.schedule('reports-daily', '0 0 * * *', async () => {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    queue.add('reports', { type: 'daily', date });
  });

  // Monthly reports - runs on 1st of each month at midnight
  scheduler.schedule('reports-monthly', '0 0 1 * *', async () => {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    queue.add('reports', { type: 'monthly', date });
  });

  // Sync job - runs every 30 minutes
  scheduler.schedule('sync-periodic', '1800000', async () => {
    queue.add('sync', { syncType: 'contract_state' });
  });

  // Cache warm - runs every 15 minutes
  scheduler.schedule('cache-warm', '900000', async () => {
    queue.add('cacheWarm', { cacheType: 'meter_data' });
  });

  // Start the scheduler
  scheduler.start();

  services.scheduler = scheduler;
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

    if (services.scheduler) {
      await services.scheduler.close();
      log.info('Scheduler shutdown complete');
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

const { childLogger } = require('../config/logger');
const { queue } = require('./queue');

const log = childLogger('webhook');

/**
 * Resolve the queue to enqueue webhook deliveries onto.
 *
 * Prefers the service-registry instance (wired up during initServices), and
 * falls back to the queue singleton so delivery works even when the webhook
 * service is used before/without service initialization (tests, scripts).
 * Previously this read services.queue unconditionally, which is null until
 * initServices() runs, so any early deliver() call crashed with
 * "Cannot read properties of null (reading 'add')".
 *
 * @returns {import('./queue')|null} queue instance or null when unavailable
 */
function resolveQueue() {
  // Lazy require to avoid a circular import: services/index registers this
  // module's handler onto the same singleton queue.
  try {
    const { services } = require('./index');
    if (services && services.queue) return services.queue;
  } catch {
    // services/index not loaded or circular - fall through to the singleton
  }
  return queue || null;
}

/**
 * Webhook service for delivering webhooks with queue-based retries
 */
class WebhookService {
  /**
   * Deliver a webhook with automatic retry via queue
   * @param {string} url - Target webhook URL
   * @param {Object} payload - Webhook payload
   * @param {Object} options - Delivery options
   * @returns {string} Job ID
   */
  async deliver(url, payload, options = {}) {
    const queueInstance = resolveQueue();
    if (!queueInstance) {
      throw new Error('Queue service unavailable: cannot queue webhook delivery');
    }

    const webhookId = `webhook_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    
    log.info({ webhookId, url }, 'Queuing webhook for delivery');

    // Add webhook retry job to queue
    const jobId = queueInstance.add('webhookRetry', {
      webhookId,
      url,
      payload,
      attempt: 1,
    }, {
      priority: options.priority || 2, // Normal priority
      maxAttempts: options.maxAttempts || 3,
    });

    return jobId;
  }

  /**
   * Get webhook delivery status
   * @param {string} jobId - Job ID from deliver()
   * @returns {Object|null} Job status
   */
  getStatus(jobId) {
    const queueInstance = resolveQueue();
    if (!queueInstance) return null;
    return queueInstance.getStatus(jobId);
  }

  /**
   * Cancel a pending webhook delivery
   * @param {string} jobId - Job ID from deliver()
   * @returns {boolean} Success status
   */
  cancel(jobId) {
    const queueInstance = resolveQueue();
    if (!queueInstance) return false;
    return queueInstance.cancel(jobId);
  }
}

// Create singleton instance
const webhookService = new WebhookService();

module.exports = webhookService;

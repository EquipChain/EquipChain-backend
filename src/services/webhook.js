const { childLogger } = require('../config/logger');
const { services } = require('./index');

const log = childLogger('webhook');

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
    const webhookId = `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    log.info({ webhookId, url }, 'Queuing webhook for delivery');

    // Add webhook retry job to queue
    const jobId = services.queue.add('webhookRetry', {
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
    return services.queue.getStatus(jobId);
  }

  /**
   * Cancel a pending webhook delivery
   * @param {string} jobId - Job ID from deliver()
   * @returns {boolean} Success status
   */
  cancel(jobId) {
    return services.queue.cancel(jobId);
  }
}

// Create singleton instance
const webhookService = new WebhookService();

module.exports = webhookService;

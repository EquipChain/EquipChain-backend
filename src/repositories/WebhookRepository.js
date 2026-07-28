/**
 * WebhookRepository — Webhook Registrations and Delivery Logs Store
 *
 * Manages webhook endpoint registrations and tracks delivery logs.
 *
 * Domain-specific methods:
 *   - findByEvent(event)
 *   - findByUrl(url)
 *   - findByStatus(status)
 *   - logDelivery(webhookId, status, response)
 *   - getDeliveryLogs(webhookId)
 */

const BaseRepository = require('./BaseRepository');

class WebhookRepository extends BaseRepository {
  constructor() {
    super({ entityName: 'webhook' });
    this._allowedFilters = ['event', 'status'];
    this._sortableFields = ['url', 'event', 'status', 'createdAt'];
    this._searchableFields = ['url', 'description'];

    /** @type {Map<string, Array>} */
    this._deliveryLogs = new Map();
  }

  /**
   * Find webhooks registered for a specific event.
   * Supports matching single event string, events array, or wildcard '*'.
   * @param {string} event
   * @returns {Promise<Array>}
   */
  async findByEvent(event) {
    return [...this._store.values()]
      .filter((w) => {
        if (w.status !== 'active') return false;
        if (w.event === event || w.event === '*') return true;
        if (Array.isArray(w.events)) {
          return w.events.includes(event) || w.events.includes('*');
        }
        return false;
      })
      .map((w) => ({ ...w }));
  }

  /**
   * Find a webhook by its URL.
   * @param {string} url
   * @returns {Promise<Object|null>}
   */
  async findByUrl(url) {
    for (const webhook of this._store.values()) {
      if (webhook.url === url) {
        return { ...webhook };
      }
    }
    return null;
  }

  /**
   * Find webhooks by status.
   * @param {'active'|'inactive'|'failed'} status
   * @returns {Promise<Array>}
   */
  async findByStatus(status) {
    return [...this._store.values()]
      .filter((w) => w.status === status)
      .map((w) => ({ ...w }));
  }

  /**
   * Log a delivery attempt for a webhook.
   * @param {string} webhookId
   * @param {number} statusCode - HTTP status code returned (or 0 for network failure)
   * @param {Object|string|null} [response] - Optional response body or error
   * @param {Object} [metadata] - Additional delivery details (attempt, eventId, eventType, etc.)
   */
  async logDelivery(webhookId, statusCode, response, metadata = {}) {
    if (!this._deliveryLogs.has(webhookId)) {
      this._deliveryLogs.set(webhookId, []);
    }
    this._deliveryLogs.get(webhookId).push({
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      webhookId,
      timestamp: new Date().toISOString(),
      statusCode,
      response: response || null,
      ...metadata,
    });
  }

  /**
   * Get delivery logs for a specific webhook.
   * @param {string} webhookId
   * @returns {Promise<Array>}
   */
  async getDeliveryLogs(webhookId) {
    return this._deliveryLogs.get(webhookId) || [];
  }

  /**
   * Clear delivery logs for all webhooks.
   */
  async clearDeliveryLogs() {
    this._deliveryLogs.clear();
  }

  /**
   * Clear all data including delivery logs.
   */
  async clear() {
    await super.clear();
    this._deliveryLogs.clear();
  }
}

module.exports = WebhookRepository;

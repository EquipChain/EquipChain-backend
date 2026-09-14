'use strict';

// src/repositories/WebhookRepository.js
// CommonJS port of WebhookRepository.ts (part of restoring the broken
// repository layer after the unfinished TypeScript migration).

const BaseRepository = require('./BaseRepository');

class WebhookRepository extends BaseRepository {
  constructor() {
    super({ entityName: 'webhook' });
    this._allowedFilters = ['event', 'status'];
    this._sortableFields = ['url', 'event', 'status', 'createdAt'];
    this._searchableFields = ['url', 'description'];
    this._deliveryLogs = new Map();
  }

  /**
   * Active webhooks subscribed to an event.
   * @param {string} event
   * @returns {Promise<Object[]>}
   */
  async findByEvent(event) {
    return [...this._store.values()]
      .filter((w) => w.event === event && w.status === 'active')
      .map((w) => ({ ...w }));
  }

  /**
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
   * @param {string} status
   * @returns {Promise<Object[]>}
   */
  async findByStatus(status) {
    return [...this._store.values()]
      .filter((w) => w.status === status)
      .map((w) => ({ ...w }));
  }

  /**
   * Append a delivery log entry for a webhook.
   * @param {string} webhookId
   * @param {number} statusCode
   * @param {*} [response]
   */
  async logDelivery(webhookId, statusCode, response) {
    if (!this._deliveryLogs.has(webhookId)) {
      this._deliveryLogs.set(webhookId, []);
    }
    this._deliveryLogs.get(webhookId).push({
      timestamp: new Date().toISOString(),
      statusCode,
      response: response || null,
    });
  }

  /**
   * @param {string} webhookId
   * @returns {Promise<Object[]>}
   */
  async getDeliveryLogs(webhookId) {
    return this._deliveryLogs.get(webhookId) || [];
  }

  async clearDeliveryLogs() {
    this._deliveryLogs.clear();
  }

  async clear() {
    await super.clear();
    this._deliveryLogs.clear();
  }
}

module.exports = WebhookRepository;
module.exports.WebhookRepository = WebhookRepository;
module.exports.webhookRepository = new WebhookRepository();

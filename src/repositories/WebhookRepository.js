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
   * Per-webhook delivery-log cap. Every delivery attempt appends to the
   * webhook's log array; a high-frequency event subscribed to by a
   * long-lived webhook would otherwise grow that array without bound and
   * slowly consume the heap (each entry also retains the response body).
   * Logs exist for operator debugging - the most recent window is what
   * matters, so append-then-truncate keeps the newest entries.
   */
  MAX_DELIVERY_LOGS_PER_WEBHOOK = 100;

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
   * Append a delivery log entry for a webhook. The per-webhook log is
   * capped at MAX_DELIVERY_LOGS_PER_WEBHOOK: once full, the oldest entry is
   * dropped for every new one (a ring buffer over an array), so a busy
   * webhook cannot grow memory without bound for as long as it runs.
   * @param {string} webhookId
   * @param {number} statusCode
   * @param {*} [response]
   */
  async logDelivery(webhookId, statusCode, response) {
    if (!this._deliveryLogs.has(webhookId)) {
      this._deliveryLogs.set(webhookId, []);
    }
    const logs = this._deliveryLogs.get(webhookId);
    logs.push({
      timestamp: new Date().toISOString(),
      statusCode,
      response: response || null,
    });
    if (logs.length > this.MAX_DELIVERY_LOGS_PER_WEBHOOK) {
      this._deliveryLogs.set(webhookId, logs.slice(-this.MAX_DELIVERY_LOGS_PER_WEBHOOK));
    }
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

  /**
   * Delete a webhook and its delivery logs. The base implementation only
   * removes the record; leaving the logs keyed by a now-nonexistent id
   * would leak them for the lifetime of the process (nothing else removes
   * Map entries here), so deletion cleans both.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async delete(id) {
    const deleted = await super.delete(id);
    if (deleted) {
      this._deliveryLogs.delete(id);
    }
    return deleted;
  }
}

module.exports = WebhookRepository;
module.exports.WebhookRepository = WebhookRepository;
module.exports.webhookRepository = new WebhookRepository();

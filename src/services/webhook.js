/**
 * Webhook Service
 *
 * Manages webhook registrations, event dispatching, payload HMAC signing,
 * HTTP delivery, and retries with exponential backoff.
 */

const crypto = require('node:crypto');
const { webhookRepository } = require('../repositories');
const { appEventEmitter } = require('./eventEmitter');
const { childLogger } = require('../config/logger');

const log = childLogger('webhook-service');

// Default retry backoff schedule: 1min, 5min, 15min
const DEFAULT_RETRY_DELAYS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
const DEFAULT_MAX_RETRIES = 3;

/**
 * Standard supported webhook event types
 */
const SUPPORTED_EVENTS = [
  'meter.reading.created',
  'meter.reading.updated',
  'contract.state.changed',
  'system.alert.high',
  'user.registered',
  'admin.action',
];

/**
 * Generate HMAC-SHA256 signature for payload verification
 * @param {string} secret - Shared secret key
 * @param {string} payload - JSON payload string
 * @returns {string} Hex signature
 */
function generateSignature(secret, payload) {
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify HMAC-SHA256 signature
 * @param {string} secret - Shared secret key
 * @param {string} payload - JSON payload string
 * @param {string} signature - Hex signature to check
 * @returns {boolean}
 */
function verifySignature(secret, payload, signature) {
  if (!secret || !signature) return false;
  const expected = generateSignature(secret, payload);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

class WebhookService {
  constructor(options = {}) {
    this.repository = options.repository || webhookRepository;
    this.retryDelays = options.retryDelays || DEFAULT_RETRY_DELAYS;
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : DEFAULT_MAX_RETRIES;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this._listening = false;
  }

  /**
   * Register a new webhook endpoint.
   * @param {Object|string} urlOrData - Webhook configuration object or URL string
   * @param {Array<string>|string} [events] - Event types to subscribe to
   * @param {string} [secret] - Shared secret for HMAC signing
   * @returns {Promise<Object>} The registered webhook
   */
  async registerWebhook(urlOrData, events, secret) {
    let data;
    if (typeof urlOrData === 'string') {
      data = {
        url: urlOrData,
        events: Array.isArray(events) ? events : events ? [events] : ['*'],
        secret: secret || '',
      };
    } else {
      data = { ...urlOrData };
    }

    // Normalize events array
    const eventList = Array.isArray(data.events)
      ? data.events
      : typeof data.events === 'string'
      ? [data.events]
      : typeof data.event === 'string'
      ? [data.event]
      : ['*'];

    const id = data.id || `wh_${crypto.randomBytes(12).toString('hex')}`;

    const webhookData = {
      id,
      url: data.url,
      events: eventList,
      event: eventList[0] || '*', // For backwards compatibility with WebhookRepository
      secret: data.secret || '',
      status: data.status || 'active',
      description: data.description || '',
    };

    return this.repository.create(webhookData);
  }

  /**
   * Unregister / delete a webhook by ID.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async unregisterWebhook(id) {
    return this.repository.delete(id);
  }

  /**
   * Get a webhook by ID.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async getWebhook(id) {
    return this.repository.findById(id);
  }

  /**
   * List all registered webhooks with optional query filtering & pagination.
   * @param {Object} [query]
   * @param {Object} [options]
   * @returns {Promise<{ data: Array, pagination: Object }>}
   */
  async listWebhooks(query = {}, options = {}) {
    return this.repository.findAll(query, options);
  }

  /**
   * Update an existing webhook registration.
   * @param {string} id
   * @param {Object} data
   * @returns {Promise<Object|null>}
   */
  async updateWebhook(id, data) {
    const existing = await this.repository.findById(id);
    if (!existing) return null;

    const updates = { ...data };
    if (updates.events) {
      const eventList = Array.isArray(updates.events) ? updates.events : [updates.events];
      updates.events = eventList;
      updates.event = eventList[0] || existing.event;
    }

    return this.repository.update(id, updates);
  }

  /**
   * Dispatch an event to all matching registered webhooks asynchronously.
   * @param {string} eventType - e.g., 'meter.reading.created'
   * @param {Object} payload - Event specific payload data
   * @returns {Promise<Array<Object>>} Delivery promises
   */
  async dispatchEvent(eventType, payload = {}) {
    const activeWebhooks = await this.repository.findByEvent(eventType);

    if (activeWebhooks.length === 0) {
      log.debug({ eventType }, 'No active webhooks registered for event');
      return [];
    }

    const eventId = `evt_${crypto.randomBytes(12).toString('hex')}`;
    const timestamp = new Date().toISOString();

    const deliveries = activeWebhooks.map((webhook) => {
      const event = {
        id: eventId,
        type: eventType,
        created: timestamp,
        data: payload,
        webhookId: webhook.id,
      };

      // Non-blocking background dispatch
      return this.deliverWebhook(webhook, event).catch((err) => {
        log.error({ err, webhookId: webhook.id, eventId }, 'Unhandled delivery error');
      });
    });

    return Promise.all(deliveries);
  }

  /**
   * Deliver a webhook event to a specific target URL with timeout and retry logic.
   * @param {Object} webhook - Webhook configuration object
   * @param {Object} event - Formatted event object
   * @param {Object} [options] - Overrides for attempt, retryDelays, fetchImpl
   * @returns {Promise<{ success: boolean, statusCode: number, attempt: number, response?: any, error?: string }>}
   */
  async deliverWebhook(webhook, event, options = {}) {
    const attempt = options.attempt || 1;
    const retryDelays = options.retryDelays || this.retryDelays;
    const maxRetries = options.maxRetries !== undefined ? options.maxRetries : this.maxRetries;
    const fetchImpl = options.fetchImpl || this.fetchImpl;

    const bodyString = JSON.stringify(event);

    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'EquipChain-Webhook/1.0',
      'X-Webhook-Event': event.type,
      'X-Webhook-ID': event.id,
    };

    if (webhook.secret) {
      headers['X-Webhook-Signature'] = generateSignature(webhook.secret, bodyString);
    }

    let responseStatusCode = 0;
    let responseData = null;
    let deliveryError = null;
    let isSuccess = false;

    try {
      const controller = new AbortController();
      const timeoutMs = options.timeoutMs || 10000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetchImpl(webhook.url, {
        method: 'POST',
        headers,
        body: bodyString,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      responseStatusCode = res.status;

      let text = '';
      try {
        text = await res.text();
        responseData = text ? JSON.parse(text) : null;
      } catch {
        responseData = text;
      }

      if (res.ok) {
        isSuccess = true;
      } else {
        deliveryError = `HTTP ${res.status}: ${res.statusText || 'Delivery Failed'}`;
      }
    } catch (err) {
      deliveryError = err.name === 'AbortError' ? 'Request Timeout (10s)' : err.message;
      responseStatusCode = 0;
    }

    // Log the delivery attempt in repository
    await this.repository.logDelivery(webhook.id, responseStatusCode, responseData || deliveryError, {
      eventId: event.id,
      eventType: event.type,
      attempt,
      success: isSuccess,
      error: deliveryError,
      url: webhook.url,
    });

    log.info(
      {
        webhookId: webhook.id,
        eventId: event.id,
        eventType: event.type,
        attempt,
        statusCode: responseStatusCode,
        success: isSuccess,
        error: deliveryError,
      },
      `Webhook delivery attempt ${attempt} ${isSuccess ? 'succeeded' : 'failed'}`
    );

    if (isSuccess) {
      return {
        success: true,
        statusCode: responseStatusCode,
        attempt,
        response: responseData,
      };
    }

    // Handle retry logic if attempt count is within maxRetries limit
    if (attempt <= maxRetries) {
      const delayIndex = attempt - 1;
      const delayMs = retryDelays[delayIndex] !== undefined ? retryDelays[delayIndex] : retryDelays[retryDelays.length - 1];

      log.info(
        { webhookId: webhook.id, attempt, nextAttempt: attempt + 1, delayMs },
        `Scheduling webhook retry attempt ${attempt + 1} in ${delayMs}ms`
      );

      // If scheduled in test environment or custom schedule callback provided
      if (options.onRetryScheduled) {
        options.onRetryScheduled(attempt + 1, delayMs);
      }

      if (options.syncRetry) {
        // Synchronous retry for unit testing without waiting full setTimeout duration
        return this.deliverWebhook(webhook, event, { ...options, attempt: attempt + 1 });
      }

      // Asynchronous non-blocking retry schedule
      setTimeout(() => {
        this.deliverWebhook(webhook, event, { ...options, attempt: attempt + 1 }).catch((err) => {
          log.error({ err, webhookId: webhook.id }, 'Retry execution error');
        });
      }, delayMs);
    }

    return {
      success: false,
      statusCode: responseStatusCode,
      attempt,
      error: deliveryError,
    };
  }

  /**
   * Listen to global application event emitter.
   */
  startListening() {
    if (this._listening) return;

    for (const eventType of SUPPORTED_EVENTS) {
      appEventEmitter.on(eventType, (payload) => {
        this.dispatchEvent(eventType, payload);
      });
    }

    this._listening = true;
    log.info('Webhook service listening for application events');
  }
}

// Singleton service instance
const webhookService = new WebhookService();

module.exports = {
  webhookService,
  WebhookService,
  generateSignature,
  verifySignature,
  SUPPORTED_EVENTS,
  DEFAULT_RETRY_DELAYS,
  DEFAULT_MAX_RETRIES,
};

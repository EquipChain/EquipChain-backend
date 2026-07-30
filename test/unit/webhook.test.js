const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const {
  WebhookService,
  generateSignature,
  verifySignature,
  SUPPORTED_EVENTS,
} = require('../../src/services/webhook');
const { WebhookRepository } = require('../../src/repositories');
const { appEventEmitter } = require('../../src/services/eventEmitter');

describe('Webhook Unit Tests', () => {
  let repository;
  let service;

  beforeEach(async () => {
    repository = new WebhookRepository();
    await repository.clear();
    service = new WebhookService({
      repository,
      maxRetries: 3,
      retryDelays: [10, 20, 30], // Short delays for fast unit testing
    });
  });

  afterEach(async () => {
    await repository.clear();
  });

  describe('HMAC Signature Generation & Verification', () => {
    it('computes valid HMAC-SHA256 signature string', () => {
      const secret = 'super-secret-key-123';
      const payload = JSON.stringify({ event: 'test', data: { value: 42 } });

      const signature = generateSignature(secret, payload);
      assert.ok(signature);
      assert.strictEqual(typeof signature, 'string');
      assert.strictEqual(signature.length, 64); // SHA-256 hex string length

      const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      assert.strictEqual(signature, expected);
    });

    it('verifies valid HMAC signature successfully', () => {
      const secret = 'super-secret-key-123';
      const payload = JSON.stringify({ event: 'test' });
      const signature = generateSignature(secret, payload);

      assert.strictEqual(verifySignature(secret, payload, signature), true);
      assert.strictEqual(verifySignature(secret, payload, 'invalid-signature'), false);
      assert.strictEqual(verifySignature('wrong-secret', payload, signature), false);
    });
  });

  describe('Webhook Registration CRUD', () => {
    it('registers a new webhook with URL, events, and secret', async () => {
      const webhook = await service.registerWebhook(
        'https://example.com/webhook',
        ['meter.reading.created', 'contract.state.changed'],
        'my-secret'
      );

      assert.ok(webhook.id);
      assert.ok(webhook.id.startsWith('wh_'));
      assert.strictEqual(webhook.url, 'https://example.com/webhook');
      assert.deepStrictEqual(webhook.events, ['meter.reading.created', 'contract.state.changed']);
      assert.strictEqual(webhook.secret, 'my-secret');
      assert.strictEqual(webhook.status, 'active');
    });

    it('unregisters a webhook by ID', async () => {
      const webhook = await service.registerWebhook('https://example.com/hook', ['meter.reading.created']);
      const countBefore = await repository.count();
      assert.strictEqual(countBefore, 1);

      const deleted = await service.unregisterWebhook(webhook.id);
      assert.strictEqual(deleted, true);

      const countAfter = await repository.count();
      assert.strictEqual(countAfter, 0);
    });

    it('lists registered webhooks', async () => {
      await service.registerWebhook('https://example.com/hook1', ['meter.reading.created']);
      await service.registerWebhook('https://example.com/hook2', ['contract.state.changed']);

      const result = await service.listWebhooks();
      assert.strictEqual(result.data.length, 2);
    });

    it('updates webhook status and event filters', async () => {
      const webhook = await service.registerWebhook('https://example.com/hook', ['meter.reading.created']);
      const updated = await service.updateWebhook(webhook.id, {
        status: 'inactive',
        events: ['system.alert.high'],
      });

      assert.strictEqual(updated.status, 'inactive');
      assert.deepStrictEqual(updated.events, ['system.alert.high']);
    });
  });

  describe('Event Dispatching & Delivery', () => {
    it('dispatches standardized payload to subscribed webhooks', async () => {
      let receivedUrl = null;
      let receivedOptions = null;

      const mockFetch = async (url, options) => {
        receivedUrl = url;
        receivedOptions = options;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify({ received: true }),
        };
      };

      service.fetchImpl = mockFetch;

      const webhook = await service.registerWebhook(
        'https://example.com/receiver',
        ['meter.reading.created'],
        'secret-key-1'
      );

      const payloadData = { meterId: 'METER-100', value: 450.2 };
      await service.dispatchEvent('meter.reading.created', payloadData);

      assert.strictEqual(receivedUrl, 'https://example.com/receiver');
      assert.strictEqual(receivedOptions.method, 'POST');
      assert.strictEqual(receivedOptions.headers['Content-Type'], 'application/json');
      assert.strictEqual(receivedOptions.headers['X-Webhook-Event'], 'meter.reading.created');
      assert.ok(receivedOptions.headers['X-Webhook-Signature']);

      const body = JSON.parse(receivedOptions.body);
      assert.ok(body.id.startsWith('evt_'));
      assert.strictEqual(body.type, 'meter.reading.created');
      assert.strictEqual(body.webhookId, webhook.id);
      assert.deepStrictEqual(body.data, payloadData);
      assert.ok(body.created);

      // Verify delivery log recorded
      const logs = await repository.getDeliveryLogs(webhook.id);
      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0].statusCode, 200);
      assert.strictEqual(logs[0].success, true);
    });

    it('does not dispatch to inactive webhooks', async () => {
      let fetchCalled = false;
      service.fetchImpl = async () => {
        fetchCalled = true;
        return { ok: true, status: 200, text: async () => '' };
      };

      await service.registerWebhook({
        url: 'https://example.com/inactive',
        events: ['meter.reading.created'],
        status: 'inactive',
      });

      await service.dispatchEvent('meter.reading.created', { test: 1 });
      assert.strictEqual(fetchCalled, false);
    });
  });

  describe('Retry Logic & Failure Logging', () => {
    it('retries failed delivery up to 3 times with backoff', async () => {
      let attempts = 0;
      const mockFetch = async () => {
        attempts++;
        return {
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          text: async () => 'Error',
        };
      };

      const customService = new WebhookService({
        repository,
        maxRetries: 3,
        retryDelays: [10, 10, 10],
        fetchImpl: mockFetch,
      });

      const webhook = await customService.registerWebhook('https://example.com/fail', ['system.alert.high']);
      const event = {
        id: 'evt_test_retry',
        type: 'system.alert.high',
        created: new Date().toISOString(),
        data: { alert: 'high memory' },
        webhookId: webhook.id,
      };

      // Execute synchronous retries
      const result = await customService.deliverWebhook(webhook, event, { syncRetry: true });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.statusCode, 503);
      assert.strictEqual(attempts, 4); // Initial attempt + 3 retries = 4

      const logs = await repository.getDeliveryLogs(webhook.id);
      assert.strictEqual(logs.length, 4);
      assert.strictEqual(logs[0].attempt, 1);
      assert.strictEqual(logs[3].attempt, 4);
    });
  });
});

'use strict';

// test/webhookLogRetention.test.js
//
// Tests for per-webhook delivery-log retention. logDelivery used to append
// without bound - a busy webhook retained every attempt (including response
// bodies) for the life of the process, a slow memory leak that no sweeper
// covered. The cap turns the log into a ring buffer of the most recent
// attempts, and delete() now removes the logs with the webhook.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const WebhookRepository = require('../src/repositories/WebhookRepository');

describe('WebhookRepository delivery-log retention', () => {
  let repo;

  beforeEach(async () => {
    repo = new WebhookRepository();
    await repo.clear();
  });

  it('caps the per-webhook log at MAX_DELIVERY_LOGS_PER_WEBHOOK, keeping the newest', async () => {
    const webhook = await repo.create({ url: 'https://example.com/hook', event: 'e' });
    const cap = repo.MAX_DELIVERY_LOGS_PER_WEBHOOK;
    assert.ok(cap >= 10, 'cap should be large enough to be useful');

    const extra = 25;
    for (let i = 0; i < cap + extra; i++) {
      await repo.logDelivery(webhook.id, 200, `attempt-${i}`);
    }

    const logs = await repo.getDeliveryLogs(webhook.id);
    assert.strictEqual(logs.length, cap);

    // Newest kept: the last attempt must be present, the first dropped.
    assert.strictEqual(logs[logs.length - 1].response, `attempt-${cap + extra - 1}`);
    assert.notStrictEqual(logs[0].response, 'attempt-0');
  });

  it('keeps logs isolated per webhook', async () => {
    const a = await repo.create({ url: 'https://a.example.com/hook', event: 'e' });
    const b = await repo.create({ url: 'https://b.example.com/hook', event: 'e' });

    await repo.logDelivery(a.id, 200, 'a-1');
    await repo.logDelivery(b.id, 500, 'b-1');
    await repo.logDelivery(a.id, 200, 'a-2');

    const logsA = await repo.getDeliveryLogs(a.id);
    const logsB = await repo.getDeliveryLogs(b.id);
    assert.strictEqual(logsA.length, 2);
    assert.strictEqual(logsB.length, 1);
    assert.strictEqual(logsB[0].response, 'b-1');
  });

  it('deleting a webhook removes its delivery logs', async () => {
    const webhook = await repo.create({ url: 'https://example.com/hook', event: 'e' });
    await repo.logDelivery(webhook.id, 200, 'body');

    await repo.delete(webhook.id);
    const logs = await repo.getDeliveryLogs(webhook.id);
    assert.deepStrictEqual(logs, []);
  });
});

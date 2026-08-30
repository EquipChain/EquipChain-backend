const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { queue } = require('../src/services/queue');
const webhookService = require('../src/services/webhook');

describe('Webhook Service', () => {
  beforeEach(() => {
    queue.jobs.clear();
    queue.queuedJobs = [];
    queue.runningJobs.clear();
    queue.handlers.clear();
    queue.activeCount = 0;
  });

  afterEach(async () => {
    await queue.stop();
    queue.jobs.clear();
    queue.queuedJobs = [];
    queue.runningJobs.clear();
    queue.handlers.clear();
  });

  test('should queue a webhook for delivery', async () => {
    // Register a handler to prevent "no handler" failure
    queue.registerHandler('webhookRetry', async (data) => ({
      success: true,
      data,
    }));

    const jobId = await webhookService.deliver('https://example.com/webhook', {
      event: 'test',
      data: { id: 1 },
    });

    assert.ok(jobId);
    assert.ok(typeof jobId === 'string');
  });

  test('should get delivery status', async () => {
    queue.registerHandler('webhookRetry', async (data) => ({
      success: true,
      data,
    }));

    const jobId = await webhookService.deliver('https://example.com/webhook', {
      event: 'test',
    });

    const status = webhookService.getStatus(jobId);
    assert.ok(status);
    assert.strictEqual(status.id, jobId);
  });

  test('should cancel a pending delivery', async () => {
    queue.registerHandler('webhookRetry', async (data) => ({
      success: true,
      data,
    }));

    const jobId = await webhookService.deliver('https://example.com/webhook', {
      event: 'test',
    });

    const cancelled = webhookService.cancel(jobId);
    assert.strictEqual(cancelled, true);

    const status = webhookService.getStatus(jobId);
    assert.strictEqual(status.status, 'cancelled');
  });
});

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing';

const app = require('../src/app');
const { queue, JobStatus, Priority } = require('../src/services/queue');

let server;
let serverPort;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      serverPort = server.address().port;
      resolve();
    });
  });
});

after(async () => {
  await queue.close();
  await new Promise((resolve) => server.close(resolve));
});

describe('Root Route', () => {
  it('returns project info', async () => {
    const res = await fetch(`http://localhost:${serverPort}/`);
    assert.strictEqual(res.status, 200);
    
    const data = await res.json();
    assert.strictEqual(data.project, 'Equipchain');
    assert.strictEqual(data.status, 'Monitoring Meters');
    assert.ok(data.contract);
  });
});

describe('404 Handler', () => {
  it('returns 404 for non-existent routes', async () => {
    const res = await fetch(`http://localhost:${serverPort}/non-existent`);
    assert.strictEqual(res.status, 404);
    
    const data = await res.json();
    assert.strictEqual(data.error, 'Not Found');
  });

  it('returns 404 for non-existent API routes', async () => {
    const res = await fetch(`http://localhost:${serverPort}/api/non-existent`);
    assert.strictEqual(res.status, 404);
    
    const data = await res.json();
    assert.strictEqual(data.error, 'Not Found');
  });
});

describe('Security Headers', () => {
  it('includes security headers in response', async () => {
    const res = await fetch(`http://localhost:${serverPort}/`);
    assert.ok(res.headers.get('x-content-type-options'));
    assert.ok(res.headers.get('x-frame-options'));
  });
});

describe('Correlation ID', () => {
  it('generates correlation ID if not provided', async () => {
    const res = await fetch(`http://localhost:${serverPort}/`);
    assert.ok(res.headers.get('x-correlation-id'));
  });

  it('uses provided correlation ID', async () => {
    const customId = 'custom-correlation-id-123';
    const res = await fetch(`http://localhost:${serverPort}/`, {
      headers: { 'x-correlation-id': customId },
    });
    assert.strictEqual(res.headers.get('x-correlation-id'), customId);
  });
});

describe('Queue Service', () => {
  beforeEach(() => {
    queue.jobs.clear();
    queue.queuedJobs = [];
    queue.runningJobs.clear();
    queue.handlers.clear();
    queue.activeCount = 0;
    queue.isProcessing = false;
  });

  it('adds a job to the queue', () => {
    const jobId = queue.add('test-job', { data: 'test' });
    assert.ok(jobId);
    assert.ok(jobId.startsWith('job_'));
    
    const status = queue.getStatus(jobId);
    assert.strictEqual(status.status, JobStatus.QUEUED);
  });

  it('registers and executes job handlers', async () => {
    let handlerCalled = false;
    queue.registerHandler('test-handler', async (data) => {
      handlerCalled = true;
      return { success: true };
    });
    
    queue.start();
    const jobId = queue.add('test-handler', { data: 'test' });
    
    // Wait for job to complete
    await new Promise((resolve) => setTimeout(resolve, 100));
    
    assert.ok(handlerCalled);
    const status = queue.getStatus(jobId);
    assert.strictEqual(status.status, JobStatus.COMPLETED);
    assert.deepStrictEqual(status.result, { success: true });
    
    await queue.stop();
  });

  it('cancels a queued job', () => {
    const jobId = queue.add('test-job', { data: 'test' });
    const cancelled = queue.cancel(jobId);
    assert.ok(cancelled);
    
    const status = queue.getStatus(jobId);
    assert.strictEqual(status.status, JobStatus.CANCELLED);
  });

  it('returns false when cancelling non-existent job', () => {
    const cancelled = queue.cancel('non-existent-job');
    assert.strictEqual(cancelled, false);
  });

  it('returns null for non-existent job status', () => {
    const status = queue.getStatus('non-existent-job');
    assert.strictEqual(status, null);
  });

  it('returns queue statistics', () => {
    queue.add('test-job', { data: 'test1' });
    queue.add('test-job', { data: 'test2' });
    
    const stats = queue.getStats();
    assert.strictEqual(stats.queued, 2);
    assert.strictEqual(stats.total, 2);
    assert.strictEqual(stats.maxConcurrency, parseInt(process.env.JOB_CONCURRENCY || '5', 10));
  });

  it('throws error when registering non-function handler', () => {
    assert.throws(
      () => queue.registerHandler('bad-handler', 'not-a-function'),
      /Handler for job type "bad-handler" must be a function/
    );
  });
});

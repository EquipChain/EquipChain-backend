const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { queue, JobStatus, Priority } = require('../src/services/queue');

describe('JobQueue', () => {
  before(() => {
    // Reset queue state before tests
    queue.jobs.clear();
    queue.queuedJobs = [];
    queue.runningJobs.clear();
    queue.handlers.clear();
    queue.activeCount = 0;
  });

  after(async () => {
    // Cleanup after tests
    await queue.stop();
    queue.jobs.clear();
    queue.queuedJobs = [];
    queue.runningJobs.clear();
    queue.handlers.clear();
  });

  test('should register a handler', () => {
    const handler = async (data) => ({ result: 'ok', data });
    queue.registerHandler('test', handler);
    
    assert.strictEqual(queue.handlers.has('test'), true);
  });

  test('should throw error when registering non-function handler', () => {
    assert.throws(() => {
      queue.registerHandler('invalid', 'not a function');
    }, /Handler for job type "invalid" must be a function/);
  });

  test('should add a job to the queue', () => {
    const handler = async (data) => ({ result: 'ok', data });
    queue.registerHandler('addTest', handler);
    
    const jobId = queue.add('addTest', { test: 'data' });
    
    assert.strictEqual(typeof jobId, 'string');
    assert.strictEqual(queue.jobs.has(jobId), true);
    
    const job = queue.jobs.get(jobId);
    assert.strictEqual(job.type, 'addTest');
    assert.strictEqual(job.status, JobStatus.QUEUED);
    assert.strictEqual(job.data.test, 'data');
  });

  test('should get job status', () => {
    const handler = async (data) => ({ result: 'ok', data });
    queue.registerHandler('statusTest', handler);
    
    const jobId = queue.add('statusTest', { test: 'data' });
    const status = queue.getStatus(jobId);
    
    assert.strictEqual(status.id, jobId);
    assert.strictEqual(status.type, 'statusTest');
    assert.strictEqual(status.status, JobStatus.QUEUED);
  });

  test('should return null for non-existent job', () => {
    const status = queue.getStatus('non-existent-job-id');
    assert.strictEqual(status, null);
  });

  test('should cancel a queued job', () => {
    const handler = async (data) => ({ result: 'ok', data });
    queue.registerHandler('cancelTest', handler);
    
    const jobId = queue.add('cancelTest', { test: 'data' });
    const cancelled = queue.cancel(jobId);
    
    assert.strictEqual(cancelled, true);
    
    const job = queue.jobs.get(jobId);
    assert.strictEqual(job.status, JobStatus.CANCELLED);
  });

  test('should not cancel a non-existent job', () => {
    const cancelled = queue.cancel('non-existent-job-id');
    assert.strictEqual(cancelled, false);
  });

  test('should get queue statistics', () => {
    const stats = queue.getStats();
    
    assert.strictEqual(typeof stats.queued, 'number');
    assert.strictEqual(typeof stats.running, 'number');
    assert.strictEqual(typeof stats.completed, 'number');
    assert.strictEqual(typeof stats.failed, 'number');
    assert.strictEqual(typeof stats.cancelled, 'number');
    assert.strictEqual(typeof stats.total, 'number');
    assert.strictEqual(typeof stats.activeCount, 'number');
    assert.strictEqual(typeof stats.maxConcurrency, 'number');
  });

  test('should process a job successfully', async () => {
    const handler = async (data) => ({ result: 'success', data });
    queue.registerHandler('processTest', handler);
    
    queue.start();
    
    const jobId = queue.add('processTest', { test: 'data' });
    
    // Wait for job to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const job = queue.jobs.get(jobId);
    assert.strictEqual(job.status, JobStatus.COMPLETED);
    assert.strictEqual(job.result.result, 'success');
  });

  test('should retry failed job with backoff', async () => {
    let attemptCount = 0;
    const handler = async (data) => {
      attemptCount++;
      if (attemptCount < 3) {
        throw new Error('Simulated failure');
      }
      return { result: 'success after retries' };
    };
    
    queue.registerHandler('retryTest', handler);
    
    const jobId = queue.add('retryTest', { test: 'data' }, { maxAttempts: 3 });
    
    // Wait for retries to complete
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const job = queue.jobs.get(jobId);
    assert.strictEqual(job.status, JobStatus.COMPLETED);
    assert.strictEqual(job.attempts, 3);
  });

  test('should fail job after max attempts', async () => {
    const handler = async (data) => {
      throw new Error('Always fails');
    };
    
    queue.registerHandler('failTest', handler);
    
    const jobId = queue.add('failTest', { test: 'data' }, { maxAttempts: 2 });
    
    // Wait for retries to complete
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const job = queue.jobs.get(jobId);
    assert.strictEqual(job.status, JobStatus.FAILED);
    assert.strictEqual(job.attempts, 2);
    assert.strictEqual(job.error, 'Always fails');
  });

  test('should respect priority ordering', () => {
    queue.registerHandler('priorityTest', async (data) => data);
    
    const lowJob = queue.add('priorityTest', {}, { priority: Priority.LOW });
    const normalJob = queue.add('priorityTest', {}, { priority: Priority.NORMAL });
    const highJob = queue.add('priorityTest', {}, { priority: Priority.HIGH });
    
    // High priority should be first in queue
    assert.strictEqual(queue.queuedJobs[0], highJob);
    assert.strictEqual(queue.queuedJobs[1], normalJob);
    assert.strictEqual(queue.queuedJobs[2], lowJob);
  });

  test('should handle delayed job execution', async () => {
    let executed = false;
    const handler = async (data) => {
      executed = true;
      return { result: 'ok' };
    };
    
    queue.registerHandler('delayTest', handler);
    
    const jobId = queue.add('delayTest', {}, { delay: 100 });
    
    const job = queue.jobs.get(jobId);
    assert.strictEqual(job.status, JobStatus.QUEUED);
    assert.strictEqual(executed, false);
    
    // Wait for delay
    await new Promise(resolve => setTimeout(resolve, 200));
    
    assert.strictEqual(executed, true);
  });

  test('should emit events', async () => {
    const events = [];
    
    queue.on('added', (job) => events.push({ type: 'added', jobId: job.id }));
    queue.on('started', (job) => events.push({ type: 'started', jobId: job.id }));
    queue.on('completed', (job) => events.push({ type: 'completed', jobId: job.id }));
    
    const handler = async (data) => ({ result: 'ok' });
    queue.registerHandler('eventTest', handler);
    
    const jobId = queue.add('eventTest', {});
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    assert.strictEqual(events.length, 3);
    assert.strictEqual(events[0].type, 'added');
    assert.strictEqual(events[1].type, 'started');
    assert.strictEqual(events[2].type, 'completed');
  });
});

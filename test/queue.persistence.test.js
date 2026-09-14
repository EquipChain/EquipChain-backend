const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { JobQueue, JobStatus, QueueOverflowError } = require('../src/services/queue');

function tmpFile() {
  return path.join(os.tmpdir(), `queue-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

test('persistence is a no-op without a path', () => {
  const q = new JobQueue({ persistPath: '' });
  assert.strictEqual(q.persistPath, '');
  q.add('noop', {});
  assert.strictEqual(q.jobs.size, 1);
  q._persistNow(); // must not throw
});

test('queued jobs are recovered on a fresh instance', () => {
  const file = tmpFile();
  const q = new JobQueue({ persistPath: file });
  const a = q.add('email', { to: 'a@x' });
  const b = q.add('email', { to: 'b@x' });
  q._persistNow();

  const q2 = new JobQueue({ persistPath: file });
  assert.strictEqual(q2.jobs.size, 2);
  assert.ok(q2.queuedJobs.includes(a));
  assert.ok(q2.queuedJobs.includes(b));
  assert.strictEqual(q2.jobs.get(a).data.to, 'a@x');
  assert.strictEqual(q2.jobs.get(a).status, JobStatus.QUEUED);
  fs.rmSync(file, { force: true });
});

test('running jobs are re-queued after a crash', () => {
  const file = tmpFile();
  const q = new JobQueue({ persistPath: file });
  const id = q.add('work', {});
  // Simulate a crash while the job is running: snapshot with RUNNING status.
  const job = q.jobs.get(id);
  job.status = JobStatus.RUNNING;
  q._persistNow();

  const q2 = new JobQueue({ persistPath: file });
  assert.strictEqual(q2.jobs.get(id).status, JobStatus.QUEUED);
  assert.ok(q2.queuedJobs.includes(id), 'recovered RUNNING job must be re-queued');
  fs.rmSync(file, { force: true });
});

test('delayed jobs re-arm their remaining delay, not run immediately', async () => {
  const file = tmpFile();
  const q = new JobQueue({ persistPath: file });
  const delayed = q.add('later', {}, { delay: 60_000 });
  q._persistNow();

  const q2 = new JobQueue({ persistPath: file });
  assert.strictEqual(q2.jobs.size, 1);
  assert.ok(!q2.queuedJobs.includes(delayed), 'delayed job must not queue before its deadline');
  assert.ok(q2.jobs.get(delayed).runAt > Date.now());
  fs.rmSync(file, { force: true });
});

test('close() flushes a final snapshot so graceful restarts keep queued work', async () => {
  const file = tmpFile();
  const q = new JobQueue({ persistPath: file });
  const id = q.add('billing', { month: '2026-09' });
  await q.close();
  assert.strictEqual(q.jobs.size, 0, 'memory is cleared after close');

  const q2 = new JobQueue({ persistPath: file });
  assert.ok(q2.queuedJobs.includes(id), 'job must survive a graceful restart');
  fs.rmSync(file, { force: true });
});

test('a corrupt snapshot starts empty instead of crashing boot', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{not valid json!!');
  const q = new JobQueue({ persistPath: file });
  assert.strictEqual(q.jobs.size, 0);
  q.add('work', {});
  assert.strictEqual(q.jobs.size, 1);
  fs.rmSync(file, { force: true });
});

test('cancelled jobs are persisted as terminal and not re-queued', () => {
  const file = tmpFile();
  const q = new JobQueue({ persistPath: file });
  const id = q.add('work', {});
  assert.strictEqual(q.cancel(id), true);
  q._persistNow();

  const q2 = new JobQueue({ persistPath: file });
  assert.strictEqual(q2.jobs.get(id).status, JobStatus.CANCELLED);
  assert.ok(!q2.queuedJobs.includes(id));
  fs.rmSync(file, { force: true });
});

test('a hung handler times out, releases its slot, and retries', async () => {
  const q = new JobQueue();
  let calls = 0;
  let aborted = false;
  q.registerHandler('hang', (_data, { signal } = {}) => {
    calls++;
    return new Promise((resolve) => {
      if (signal.aborted) {
        aborted = true;
        resolve('late');
        return;
      }
      signal.addEventListener('abort', () => {
        aborted = true;
      });
      // Never resolves on its own; the abort ends the wait.
      signal.addEventListener('abort', () => resolve('late'));
    });
  });

  const id = q.add('hang', {}, { timeoutMs: 50, maxAttempts: 2 });
  q.start();

  const sawTimeoutFailure = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    q.on('retry', (job) => {
      if (job.id === id && job.error && job.error.includes('timed out')) {
        clearTimeout(timer);
        resolve(true);
      }
    });
  });
  assert.ok(sawTimeoutFailure, 'expected a retry with a timeout error');
  assert.strictEqual(aborted, true, 'handler signal must fire on timeout');
  assert.strictEqual(calls, 1, 'first attempt only at this point (backoff pending)');

  await q.close();
});

test('a handler finishing within its budget is unaffected by the timeout', async () => {
  const q = new JobQueue();
  q.registerHandler('quick', async () => 'ok');
  const id = q.add('quick', {}, { timeoutMs: 1000 });
  q.start();

  await new Promise((resolve) => q.once('completed', resolve));
  assert.strictEqual(q.getStatus(id).status, JobStatus.COMPLETED);
  assert.strictEqual(q.getStatus(id).result, 'ok');
  await q.close();
});

test('timeoutMs=0 disables the budget entirely', async () => {
  const q = new JobQueue();
  q.registerHandler('slow', async () => {
    await new Promise((r) => setTimeout(r, 120));
    return 'done';
  });
  const id = q.add('slow', {}, { timeoutMs: 0 });
  q.start();

  await new Promise((resolve) => q.once('completed', resolve));
  assert.strictEqual(q.getStatus(id).result, 'done');
  await q.close();
});

test('add() rejects jobs beyond the depth cap with QueueOverflowError', () => {
  const q = new JobQueue({ maxDepth: 3 });
  const ids = [q.add('a', {}), q.add('b', {}), q.add('c', {})];
  assert.strictEqual(q.queuedJobs.length, 3);

  assert.throws(
    () => q.add('d', {}),
    (err) => err.name === 'QueueOverflowError' && err.code === 'QUEUE_FULL'
  );
  // Queue unchanged, rejection counted for observability.
  assert.strictEqual(q.queuedJobs.length, 3);
  assert.strictEqual(q.rejectedCount, 1);
  assert.strictEqual(q.getStats().rejected, 1);
});

test('completing jobs frees depth capacity again', async () => {
  const q = new JobQueue({ maxDepth: 2 });
  q.registerHandler('work', async () => 'ok');
  q.add('work', {});
  q.add('work', {});

  assert.throws(() => q.add('work', {}), QueueOverflowError);

  q.start();
  await new Promise((resolve) => {
    let done = 0;
    q.on('completed', () => {
      done++;
      if (done === 2) resolve();
    });
  });

  // Terminal jobs no longer occupy queue depth: a new add succeeds.
  const id = q.add('work', {});
  assert.ok(id);
  await q.close();
});

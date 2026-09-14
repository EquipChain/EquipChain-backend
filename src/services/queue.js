const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { childLogger } = require('../config/logger');

const log = childLogger('queue');

// Environment configuration
const JOB_CONCURRENCY = parseInt(process.env.JOB_CONCURRENCY || '5', 10);
const JOB_RETRY_ATTEMPTS = parseInt(process.env.JOB_RETRY_ATTEMPTS || '3', 10);

// Optional file-backed persistence. Jobs previously lived only in memory, so
// any restart silently dropped every queued and in-flight job. When
// QUEUE_PERSIST_PATH is set, the queue writes atomic JSON snapshots of its
// state (debounced) and reloads them at construction: QUEUED jobs resume,
// RUNNING jobs are re-queued (they were in-flight when the process died).
const QUEUE_PERSIST_PATH = process.env.QUEUE_PERSIST_PATH || '';
const PERSIST_FLUSH_MS = parseInt(process.env.QUEUE_PERSIST_FLUSH_MS || '250', 10);
const CLOSE_DRAIN_TIMEOUT_MS = parseInt(process.env.QUEUE_DRAIN_TIMEOUT_MS || '5000', 10);

// Per-job wall-clock budget. A hung handler otherwise pins a concurrency
// slot forever, slowly starving the queue. The timeout failure flows through
// the normal retry ladder; handlers may accept an AbortSignal that fires on
// timeout so they can cancel in-flight work (HTTP calls, timers, ...).
// 0 disables the budget entirely.
const JOB_TIMEOUT_MS = parseInt(process.env.JOB_TIMEOUT_MS || '60000', 10);

// Completed/failed jobs are kept for status inspection (getStats, getStatus)
// but must not accumulate forever: the billing/sync/cacheWarm schedules add
// jobs every few minutes, so an unbounded Map grows for the life of the
// process. Oldest terminal jobs are evicted once the cap is hit.
const JOB_HISTORY_LIMIT = parseInt(process.env.JOB_HISTORY_LIMIT || '1000', 10);

// Job status constants
const JobStatus = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

// Priority levels
const Priority = {
  HIGH: 3,
  NORMAL: 2,
  LOW: 1,
};

class JobQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.jobs = new Map(); // jobId -> job object
    this.queuedJobs = []; // array of jobIds sorted by priority
    this.runningJobs = new Set(); // set of jobIds currently running
    this.handlers = new Map(); // job type -> handler function
    this.activeCount = 0;
    this.isProcessing = false;

    // Durability: optional snapshot file (see QUEUE_PERSIST_PATH above).
    // Instances may override the path so tests can use isolated files.
    this.persistPath =
      options.persistPath !== undefined ? options.persistPath : QUEUE_PERSIST_PATH;
    this._persistTimer = null;
    this._loadPersisted();
  }

  /**
   * Register a job handler
   * @param {string} type - Job type identifier
   * @param {Function} handler - Handler function
   */
  registerHandler(type, handler) {
    if (typeof handler !== 'function') {
      throw new Error(`Handler for job type "${type}" must be a function`);
    }
    this.handlers.set(type, handler);
    log.info({ type }, 'Job handler registered');
  }

  /**
   * Add a job to the queue
   * @param {string} type - Job type
   * @param {Object} data - Job data
   * @param {Object} options - Job options
   * @returns {string} Job ID
   */
  add(type, data = {}, options = {}) {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const job = {
      id: jobId,
      type,
      data,
      status: JobStatus.QUEUED,
      priority: options.priority || Priority.NORMAL,
      attempts: 0,
      maxAttempts: options.maxAttempts || JOB_RETRY_ATTEMPTS,
      timeoutMs: options.timeoutMs !== undefined ? options.timeoutMs : JOB_TIMEOUT_MS,
      delay: options.delay || 0,
      runAt: null,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      failedAt: null,
      result: null,
      error: null,
    };

    this.jobs.set(jobId, job);
    if (job.delay > 0) {
      // Absolute deadline so a restart can re-arm the remaining delay.
      job.runAt = Date.now() + job.delay;
    }
    this._schedulePersist();

    if (job.delay > 0) {
      // Schedule for delayed execution
      this.emit('added', job);
      log.info({ jobId, type, priority: job.priority, delay: job.delay }, 'Job added to queue');
      setTimeout(() => {
        if (job.status === JobStatus.QUEUED) {
          this._enqueue(jobId);
        }
      }, job.delay);
    } else {
      this.emit('added', job);
      log.info({ jobId, type, priority: job.priority }, 'Job added to queue');
      this._enqueue(jobId);
    }

    return jobId;
  }

  /**
   * Schedule a recurring job.
   *
   * Delegates to the Scheduler singleton, which owns all recurring timing.
   * This removes the duplicated interval implementation that previously
   * lived here - a setInterval clone carrying the same 2^31-1 ms timer-clamp
   * bug (a monthly interval would fire thousands of times per second) that
   * was fixed in scheduler.js. One implementation of "run this repeatedly"
   * means one place to fix timing bugs and one place to reason about
   * overlapping runs.
   *
   * @param {string} type - Job type
   * @param {Object} data - Job data
   * @param {string} intervalExpression - Interval in milliseconds, or one of
   *   the cron forms the scheduler understands (e.g. '0 * * * *')
   * @returns {string} Schedule ID
   */
  schedule(type, data, intervalExpression) {
    // Lazy require: scheduler.js does not import the queue, but keeping the
    // dependency lazy avoids any future circular-import hazard.
    const { scheduler } = require('./scheduler');

    const scheduleName = `queue-${type}`;
    if (scheduler.getSchedule(scheduleName)) {
      scheduler.cancelSchedule(scheduleName);
    }

    const scheduleId = scheduler.schedule(scheduleName, String(intervalExpression), async () => {
      this.add(type, data);
    });

    this.emit('scheduled', { scheduleId, type, intervalExpression });
    log.info({ scheduleId, type, interval: intervalExpression }, 'Recurring job scheduled via scheduler');

    return scheduleId;
  }

  /**
   * Get job status
   * @param {string} jobId - Job ID
   * @returns {Object|null} Job object or null if not found
   */
  getStatus(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      failedAt: job.failedAt,
      result: job.result,
      error: job.error,
    };
  }

  /**
   * Cancel a job
   * @param {string} jobId - Job ID
   * @returns {boolean} Success status
   */
  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return false;
    }

    if (job.status === JobStatus.RUNNING) {
      // Cannot cancel running jobs in this implementation
      return false;
    }

    job.status = JobStatus.CANCELLED;
    this._removeFromQueue(jobId);
    this._schedulePersist();
    this.emit('cancelled', job);
    log.info({ jobId }, 'Job cancelled');

    return true;
  }

  /**
   * Start processing jobs
   */
  start() {
    if (this.isProcessing) {
      log.warn('Queue is already processing');
      return;
    }

    this.isProcessing = true;
    log.info('Queue processing started');
    this._process();
  }

  /**
   * Stop processing jobs
   */
  async stop() {
    this.isProcessing = false;
    log.info('Queue processing stopped');
  }

  /**
   * Get queue statistics
   * @returns {Object} Queue stats
   */
  getStats() {
    let queued = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;
    let cancelled = 0;

    for (const job of this.jobs.values()) {
      switch (job.status) {
        case JobStatus.QUEUED:
          queued++;
          break;
        case JobStatus.RUNNING:
          running++;
          break;
        case JobStatus.COMPLETED:
          completed++;
          break;
        case JobStatus.FAILED:
          failed++;
          break;
        case JobStatus.CANCELLED:
          cancelled++;
          break;
      }
    }

    return {
      queued,
      running,
      completed,
      failed,
      cancelled,
      total: this.jobs.size,
      activeCount: this.activeCount,
      maxConcurrency: JOB_CONCURRENCY,
    };
  }

  /**
   * Enqueue a job (internal method)
   * @param {string} jobId - Job ID
   */
  _enqueue(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== JobStatus.QUEUED) {
      return;
    }

    // Insert based on priority (higher priority first)
    let inserted = false;
    for (let i = 0; i < this.queuedJobs.length; i++) {
      const queuedJob = this.jobs.get(this.queuedJobs[i]);
      if (queuedJob && job.priority > queuedJob.priority) {
        this.queuedJobs.splice(i, 0, jobId);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      this.queuedJobs.push(jobId);
    }

    this._process();
  }

  /**
   * Remove job from queue (internal method)
   * @param {string} jobId - Job ID
   */
  _removeFromQueue(jobId) {
    const index = this.queuedJobs.indexOf(jobId);
    if (index > -1) {
      this.queuedJobs.splice(index, 1);
    }
  }

  /**
   * Process jobs from the queue
   */
  async _process() {
    if (!this.isProcessing) {
      return;
    }

    // Process jobs while we have capacity
    while (this.activeCount < JOB_CONCURRENCY && this.queuedJobs.length > 0) {
      const jobId = this.queuedJobs.shift();
      const job = this.jobs.get(jobId);

      if (!job || job.status !== JobStatus.QUEUED) {
        continue;
      }

      this._executeJob(job);
    }
  }

  /**
   * Execute a single job
   * @param {Object} job - Job object
   */
  async _executeJob(job) {
    const handler = this.handlers.get(job.type);
    
    if (!handler) {
      job.status = JobStatus.FAILED;
      job.error = `No handler registered for job type "${job.type}"`;
      job.failedAt = new Date();
      this._schedulePersist();
      this.emit('failed', job);
      log.error({ jobId: job.id, type: job.type }, job.error);
      this._process();
      return;
    }

    job.status = JobStatus.RUNNING;
    job.startedAt = new Date();
    this.activeCount++;
    this.runningJobs.add(job.id);
    // Snapshot the RUNNING state: if the process dies mid-run, recovery
    // sees RUNNING in the file and re-queues the job instead of losing it.
    this._schedulePersist();
    this.emit('started', job);
    log.info({ jobId: job.id, type: job.type }, 'Job started');

    try {
      const result = await this._runWithTimeout(handler, job);

      job.status = JobStatus.COMPLETED;
      job.result = result;
      job.completedAt = new Date();
      this.activeCount--;
      this.runningJobs.delete(job.id);
      this._evictOldTerminalJobs();
      this._schedulePersist();
      this.emit('completed', job);
      log.info({ jobId: job.id, type: job.type }, 'Job completed');
    } catch (error) {
      job.attempts++;
      job.error = error.message;

      if (job.attempts < job.maxAttempts) {
        // Retry with exponential backoff
        const backoffDelay = Math.pow(2, job.attempts) * 1000;
        job.status = JobStatus.QUEUED;
        job.startedAt = null;
        this.activeCount--;
        this.runningJobs.delete(job.id);
        this._schedulePersist();

        setTimeout(() => {
          this._enqueue(job.id);
        }, backoffDelay);
        
        this.emit('retry', job);
        log.warn({ 
          jobId: job.id, 
          type: job.type, 
          attempt: job.attempts, 
          maxAttempts: job.maxAttempts,
          backoffDelay 
        }, 'Job retry scheduled');
      } else {
        // Max attempts reached
        job.status = JobStatus.FAILED;
        job.failedAt = new Date();
        this.activeCount--;
        this.runningJobs.delete(job.id);
        this._evictOldTerminalJobs();
        this._schedulePersist();
        this.emit('failed', job);
        log.error({ 
          jobId: job.id, 
          type: job.type, 
          attempts: job.attempts,
          error: error.message 
        }, 'Job failed after max attempts');
      }
    }

    // Process next jobs
    this._process();
  }

  /**
   * Run a handler under the job's wall-clock budget.
   *
   * - timeoutMs = 0 disables the budget and simply awaits the handler.
   * - On timeout, the abort controller fires so cancellable handlers (HTTP,
   *   streams, timers) can stop their work; the rejection flows through the
   *   normal retry ladder. The abandoned handler promise is deliberately not
   *   awaited again - its eventual result or rejection is ignored, so
   *   handlers must not swallow the signal to keep semantics predictable.
   *
   * @param {Function} handler - Registered job handler
   * @param {Object} job - The job being executed
   * @returns {Promise<*>} Handler result
   */
  _runWithTimeout(handler, job) {
    const timeoutMs = job.timeoutMs || 0;
    if (!(timeoutMs > 0)) {
      return Promise.resolve(handler(job.data, { signal: undefined }));
    }

    const controller = new AbortController();
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        // Reject BEFORE aborting: abort can settle the handler promise in
        // the same tick (cancellable handlers resolve on the signal), and
        // race would then hand the abandoned result to the job. Rejecting
        // first guarantees the timeout error wins.
        reject(new Error(`Job timed out after ${timeoutMs}ms`));
        controller.abort();
      }, timeoutMs);
      // A timeout must not keep the event loop alive by itself.
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    });

    let work;
    try {
      work = Promise.resolve(handler(job.data, { signal: controller.signal }));
    } catch (err) {
      clearTimeout(timer);
      return Promise.reject(err);
    }

    // Never surface a late rejection from the abandoned work as an
    // unhandledRejection: attach a no-op catch on a shadow promise.
    work.catch(() => {});

    return Promise.race([work, timeout]).finally(() => {
      clearTimeout(timer);
    });
  }

  /**
   * Evict the oldest terminal (completed/failed/cancelled) jobs once total
   * stored jobs exceed JOB_HISTORY_LIMIT. Active and queued jobs are never
   * evicted, so cancellation and status tracking keep working. Insertion-
   * ordered Maps make 'first key' the oldest job, so eviction is O(1) per
   * job rather than a sort.
   */
  _evictOldTerminalJobs() {
    if (this.jobs.size <= JOB_HISTORY_LIMIT) {
      return;
    }

    for (const [id, job] of this.jobs) {
      if (this.jobs.size <= JOB_HISTORY_LIMIT) {
        break;
      }
      if (
        job.status === JobStatus.COMPLETED ||
        job.status === JobStatus.FAILED ||
        job.status === JobStatus.CANCELLED
      ) {
        this.jobs.delete(id);
      }
    }
    this._schedulePersist();
  }

  /**
   * Close the queue and cleanup.
   *
   * Waits briefly for in-flight jobs to finish (bounded by
   * QUEUE_DRAIN_TIMEOUT_MS), then flushes a final snapshot BEFORE clearing
   * memory so queued jobs survive a graceful restart. Jobs still running at
   * deadline are safe regardless: recovery re-queues RUNNING on next boot.
   */
  async close() {
    await this.stop();

    const deadline = Date.now() + CLOSE_DRAIN_TIMEOUT_MS;
    while (this.activeCount > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (this.activeCount > 0) {
      log.warn(
        { activeCount: this.activeCount },
        'Queue close drain timeout; in-flight jobs will be re-queued on next start'
      );
    }

    this._persistNow();
    this.jobs.clear();
    this.queuedJobs = [];
    this.runningJobs.clear();
    this.handlers.clear();
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    log.info('Queue closed');
  }

  /**
   * Snapshot the full queue state for persistence.
   * @returns {Object} JSON-serialisable state
   */
  _snapshotState() {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      jobs: Array.from(this.jobs.values()).map((job) => ({ ...job })),
      queueOrder: [...this.queuedJobs],
    };
  }

  /**
   * Debounced snapshot write. Coalesces bursts of state changes (bulk adds,
   * batch completions) into one disk write per flush window.
   */
  _schedulePersist() {
    if (!this.persistPath || this._persistTimer) {
      return;
    }
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._persistNow();
    }, PERSIST_FLUSH_MS);
    // Never hold the event loop open for a metrics-style side effect.
    if (typeof this._persistTimer.unref === 'function') {
      this._persistTimer.unref();
    }
  }

  /**
   * Write the snapshot atomically: temp file + rename, so a crash mid-write
   * can never leave a truncated queue file behind.
   */
  _persistNow() {
    if (!this.persistPath) {
      return;
    }
    try {
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      const tmp = `${this.persistPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this._snapshotState()));
      fs.renameSync(tmp, this.persistPath);
    } catch (err) {
      log.error({ error: err.message, path: this.persistPath }, 'Failed to persist queue state');
    }
  }

  /**
   * Load a snapshot at construction. QUEUED jobs resume where they left off;
   * RUNNING jobs are re-queued (they were in-flight when the process died,
   * so their outcome is unknown and handlers are expected to be idempotent).
   * Delayed jobs re-arm their remaining delay from the persisted runAt.
   */
  _loadPersisted() {
    if (!this.persistPath) {
      return;
    }
    let raw;
    try {
      raw = fs.readFileSync(this.persistPath, 'utf8');
    } catch {
      return; // No snapshot yet - normal first boot.
    }

    let state;
    try {
      state = JSON.parse(raw);
    } catch (err) {
      log.error({ error: err.message }, 'Queue snapshot is corrupt; starting empty');
      return;
    }
    if (!state || !Array.isArray(state.jobs)) {
      return;
    }

    for (const job of state.jobs) {
      if (job.status === JobStatus.RUNNING) {
        job.status = JobStatus.QUEUED;
        job.startedAt = null;
      }
      this.jobs.set(job.id, job);
    }

    // Restore saved queue order, keeping priority interleaving intact.
    this.queuedJobs = (state.queueOrder || []).filter((id) => {
      const job = this.jobs.get(id);
      return job && job.status === JobStatus.QUEUED;
    });

    // Queued jobs missing from the saved order are delayed jobs: re-arm the
    // remaining wait, or enqueue immediately if the deadline already passed.
    for (const job of this.jobs.values()) {
      if (job.status !== JobStatus.QUEUED || this.queuedJobs.includes(job.id)) {
        continue;
      }
      const remaining = job.runAt ? job.runAt - Date.now() : 0;
      if (remaining > 0) {
        setTimeout(() => {
          const current = this.jobs.get(job.id);
          if (current && current.status === JobStatus.QUEUED) {
            this._enqueue(job.id);
          }
        }, remaining);
      } else {
        this.queuedJobs.push(job.id);
      }
    }

    if (this.queuedJobs.length > 0) {
      log.info(
        { recovered: this.queuedJobs.length, path: this.persistPath },
        'Recovered queued jobs from persistent snapshot'
      );
    }
  }
}

// Create singleton instance
const queue = new JobQueue();

module.exports = {
  queue,
  JobQueue,
  JobStatus,
  Priority,
};

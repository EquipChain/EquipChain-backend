const EventEmitter = require('events');
const { childLogger } = require('../config/logger');

const log = childLogger('queue');

// Environment configuration
const JOB_CONCURRENCY = parseInt(process.env.JOB_CONCURRENCY || '5', 10);
const JOB_RETRY_ATTEMPTS = parseInt(process.env.JOB_RETRY_ATTEMPTS || '3', 10);

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
  constructor() {
    super();
    this.jobs = new Map(); // jobId -> job object
    this.queuedJobs = []; // array of jobIds sorted by priority
    this.runningJobs = new Set(); // set of jobIds currently running
    this.handlers = new Map(); // job type -> handler function
    this.activeCount = 0;
    this.isProcessing = false;
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
      delay: options.delay || 0,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      failedAt: null,
      result: null,
      error: null,
    };

    this.jobs.set(jobId, job);

    if (job.delay > 0) {
      // Schedule for delayed execution
      setTimeout(() => {
        if (job.status === JobStatus.QUEUED) {
          this._enqueue(jobId);
        }
      }, job.delay);
      log.info({ jobId, type, delay: job.delay }, 'Job scheduled with delay');
    } else {
      this._enqueue(jobId);
    }

    this.emit('added', job);
    log.info({ jobId, type, priority: job.priority }, 'Job added to queue');

    return jobId;
  }

  /**
   * Schedule a recurring job
   * @param {string} type - Job type
   * @param {Object} data - Job data
   * @param {string} cronExpression - Cron expression (simplified for MVP: interval in ms)
   * @returns {string} Schedule ID
   */
  schedule(type, data, cronExpression) {
    const scheduleId = `schedule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // For MVP, treat cronExpression as interval in milliseconds
    const interval = parseInt(cronExpression, 10);
    
    if (isNaN(interval) || interval <= 0) {
      throw new Error('Invalid cron expression. For MVP, provide interval in milliseconds');
    }

    const intervalId = setInterval(() => {
      this.add(type, data);
    }, interval);

    this.emit('scheduled', { scheduleId, type, interval });
    log.info({ scheduleId, type, interval }, 'Recurring job scheduled');

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
      this.emit('failed', job);
      log.error({ jobId: job.id, type: job.type }, job.error);
      this._process();
      return;
    }

    job.status = JobStatus.RUNNING;
    job.startedAt = new Date();
    this.activeCount++;
    this.runningJobs.add(job.id);
    this.emit('started', job);
    log.info({ jobId: job.id, type: job.type }, 'Job started');

    try {
      const result = await handler(job.data);
      
      job.status = JobStatus.COMPLETED;
      job.result = result;
      job.completedAt = new Date();
      this.activeCount--;
      this.runningJobs.delete(job.id);
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
   * Close the queue and cleanup
   */
  async close() {
    await this.stop();
    this.jobs.clear();
    this.queuedJobs = [];
    this.runningJobs.clear();
    this.handlers.clear();
    log.info('Queue closed');
  }
}

// Create singleton instance
const queue = new JobQueue();

module.exports = {
  queue,
  JobStatus,
  Priority,
};

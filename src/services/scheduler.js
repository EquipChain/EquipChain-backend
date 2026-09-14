const { childLogger } = require('../config/logger');

const log = childLogger('scheduler');

// Node clamps timer delays above 2^31-1 ms (~24.8 days) down to 1ms. Waits
// longer than that must be split into chunks or a "monthly" schedule fires
// thousands of times per second (observed: runCount 3100 in four seconds,
// queue flooded, CPU pinned, graceful shutdown hung).
const MAX_TIMER_MS = 2147483647;

class Scheduler {
  constructor() {
    this.schedules = new Map(); // scheduleId -> schedule object
    this.isRunning = false;
    this._stopping = false;
  }

  /**
   * Schedule a recurring job
   * @param {string} name - Schedule name
   * @param {string} cronExpression - Cron expression (simplified for MVP: interval in ms)
   * @param {Function} handler - Handler function to execute
   * @returns {string} Schedule ID
   */
  schedule(name, cronExpression, handler) {
    if (this.schedules.has(name)) {
      throw new Error(`Schedule with name "${name}" already exists`);
    }

    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }

    // For MVP, treat cronExpression as interval in milliseconds
    // In production, this would use a proper cron parser
    const interval = this._parseInterval(cronExpression);
    
    if (interval <= 0) {
      throw new Error('Invalid cron expression. For MVP, provide interval in milliseconds or a simple cron format');
    }

    const scheduleId = `schedule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const schedule = {
      id: scheduleId,
      name,
      cronExpression,
      interval,
      handler,
      intervalId: null,
      lastRun: null,
      nextRun: null,
      runCount: 0,
      createdAt: new Date(),
    };

    this.schedules.set(name, schedule);

    if (this.isRunning) {
      this._startSchedule(schedule);
    }

    log.info({ name, cronExpression, interval }, 'Schedule created');

    return scheduleId;
  }

  /**
   * Cancel a schedule by name
   * @param {string} name - Schedule name
   * @returns {boolean} Success status
   */
  cancelSchedule(name) {
    const schedule = this.schedules.get(name);
    
    if (!schedule) {
      return false;
    }

    if (schedule.intervalId) {
      clearInterval(schedule.intervalId);
      schedule.intervalId = null;
    }

    this.schedules.delete(name);
    log.info({ name }, 'Schedule cancelled');

    return true;
  }

  /**
   * Get schedule information
   * @param {string} name - Schedule name
   * @returns {Object|null} Schedule info or null
   */
  getSchedule(name) {
    const schedule = this.schedules.get(name);
    
    if (!schedule) {
      return null;
    }

    return {
      id: schedule.id,
      name: schedule.name,
      cronExpression: schedule.cronExpression,
      interval: schedule.interval,
      lastRun: schedule.lastRun,
      nextRun: schedule.nextRun,
      runCount: schedule.runCount,
      createdAt: schedule.createdAt,
      isActive: schedule.intervalId !== null,
    };
  }

  /**
   * Get all schedules
   * @returns {Array} Array of schedule info objects
   */
  getAllSchedules() {
    const schedules = [];
    
    for (const schedule of this.schedules.values()) {
      schedules.push({
        id: schedule.id,
        name: schedule.name,
        cronExpression: schedule.cronExpression,
        interval: schedule.interval,
        lastRun: schedule.lastRun,
        nextRun: schedule.nextRun,
        runCount: schedule.runCount,
        createdAt: schedule.createdAt,
        isActive: schedule.intervalId !== null,
      });
    }

    return schedules;
  }

  /**
   * Start the scheduler
   */
  start() {
    if (this.isRunning) {
      log.warn('Scheduler is already running');
      return;
    }

    this.isRunning = true;
    log.info('Scheduler started');

    // Start all schedules
    for (const schedule of this.schedules.values()) {
      this._startSchedule(schedule);
    }
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this._stopping = true;
    log.info('Scheduler stopping');

    // Stop all schedules
    for (const schedule of this.schedules.values()) {
      if (schedule.intervalId) {
        clearTimeout(schedule.intervalId);
        schedule.intervalId = null;
      }
    }

    this.isRunning = false;
    this._stopping = false;
    log.info('Scheduler stopped');
  }

  /**
   * Parse interval from cron expression
   * For MVP, supports:
   * - Numeric milliseconds (e.g., "60000" for 1 minute)
   * - Simple cron format: "* * * * *" (min hour day month weekday)
   *   Currently only supports interval-based scheduling
   * @param {string} cronExpression - Cron expression or interval
   * @returns {number} Interval in milliseconds
   */
  _parseInterval(cronExpression) {
    // If it's a number, treat as milliseconds
    const numericValue = parseInt(cronExpression, 10);
    if (!isNaN(numericValue) && numericValue > 0) {
      return numericValue;
    }

    // Simple cron parsing for common intervals
    // Format: minute hour day month weekday
    const parts = cronExpression.split(' ').map(p => p.trim());
    
    if (parts.length !== 5) {
      return -1;
    }

    const [minute, hour, day, month, weekday] = parts;

    // Every minute
    if (minute === '*' && hour === '*' && day === '*' && month === '*' && weekday === '*') {
      return 60 * 1000;
    }

    // Every hour at minute 0
    if (minute === '0' && hour === '*' && day === '*' && month === '*' && weekday === '*') {
      return 60 * 60 * 1000;
    }

    // Every day at midnight
    if (minute === '0' && hour === '0' && day === '*' && month === '*' && weekday === '*') {
      return 24 * 60 * 60 * 1000;
    }

    // Every Monday at midnight
    if (minute === '0' && hour === '0' && day === '*' && month === '*' && weekday === '1') {
      return 7 * 24 * 60 * 60 * 1000;
    }

    // First day of every month at midnight
    if (minute === '0' && hour === '0' && day === '1' && month === '*' && weekday === '*') {
      return 30 * 24 * 60 * 60 * 1000; // Approximate
    }

    // If we can't parse it, return -1
    return -1;
  }

  /**
   * Start a single schedule.
   *
   * Implemented as a self-chaining, chunked timer instead of setInterval:
   *  1. Node clamps timer delays above 2^31-1 ms down to 1ms, so both the
   *     monthly (30-day) and weekly schedules silently fired thousands of
   *     times per second, flooding the job queue and hanging shutdown.
   *     Waits longer than MAX_TIMER_MS are split into sequential chunks that
   *     individually stay under the clamp.
   *  2. Chaining guarantees no overlapping runs: the next tick is scheduled
   *     only after the previous handler settles, so a slow handler cannot
   *     pile up concurrent executions the way setInterval does.
   *  3. Timers are unref'd so the scheduler never keeps an otherwise-idle
   *     process (or a test runner waiting on an empty event loop) alive.
   *
   * @param {Object} schedule - Schedule object
   */
  _startSchedule(schedule) {
    if (schedule.intervalId) {
      return;
    }

    const run = async () => {
      if (this._stopping || !this.schedules.has(schedule.name)) {
        return;
      }

      schedule.lastRun = new Date();
      schedule.runCount++;

      log.info({
        name: schedule.name,
        runCount: schedule.runCount,
        lastRun: schedule.lastRun,
      }, 'Executing scheduled job');

      try {
        await schedule.handler();
        log.info({ name: schedule.name }, 'Scheduled job completed successfully');
      } catch (error) {
        log.error({ 
          name: schedule.name, 
          error: error.message 
        }, 'Scheduled job failed');
      }

      if (this._stopping || !this.schedules.has(schedule.name)) {
        return;
      }

      schedule.nextRun = new Date(Date.now() + schedule.interval);
      armWait(schedule.interval);
    };

    // armWait waits `ms` milliseconds, splitting the wait into chunks no
    // longer than MAX_TIMER_MS so Node's clamp can never compress a long
    // schedule into a 1ms hot loop.
    const armWait = (ms) => {
      if (this._stopping || !this.schedules.has(schedule.name)) {
        return;
      }
      const chunk = Math.min(ms, MAX_TIMER_MS);
      schedule.intervalId = setTimeout(() => {
        if (this._stopping || !this.schedules.has(schedule.name)) {
          return;
        }
        if (chunk < ms) {
          armWait(ms - chunk);
        } else {
          run();
        }
      }, chunk);
      if (typeof schedule.intervalId.unref === 'function') {
        schedule.intervalId.unref();
      }
    };

    schedule.nextRun = new Date(Date.now() + schedule.interval);
    armWait(schedule.interval);

    log.info({
      name: schedule.name,
      interval: schedule.interval,
      nextRun: schedule.nextRun,
    }, 'Schedule started');
  }

  /**
   * Cleanup and close scheduler
   */
  async close() {
    this.stop();
    this.schedules.clear();
    log.info('Scheduler closed');
  }
}

// Create singleton instance
const scheduler = new Scheduler();

module.exports = {
  scheduler,
  Scheduler,
};

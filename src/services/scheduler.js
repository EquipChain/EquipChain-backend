const { childLogger } = require('../config/logger');

const log = childLogger('scheduler');

class Scheduler {
  constructor() {
    this.schedules = new Map(); // scheduleId -> schedule object
    this.isRunning = false;
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

    this.isRunning = false;
    log.info('Scheduler stopping');

    // Stop all schedules
    for (const schedule of this.schedules.values()) {
      if (schedule.intervalId) {
        clearInterval(schedule.intervalId);
        schedule.intervalId = null;
      }
    }

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
   * Start a single schedule
   * @param {Object} schedule - Schedule object
   */
  _startSchedule(schedule) {
    if (schedule.intervalId) {
      return;
    }

    schedule.intervalId = setInterval(async () => {
      schedule.lastRun = new Date();
      schedule.runCount++;
      schedule.nextRun = new Date(Date.now() + schedule.interval);

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
    }, schedule.interval);

    schedule.nextRun = new Date(Date.now() + schedule.interval);

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
};

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { scheduler } = require('../src/services/scheduler');

describe('Scheduler', () => {
  before(() => {
    // Reset scheduler state before tests
    scheduler.schedules.clear();
    scheduler.isRunning = false;
  });

  after(async () => {
    // Cleanup after tests
    await scheduler.stop();
    scheduler.schedules.clear();
  });

  test('should create a schedule', () => {
    const handler = async () => ({ result: 'ok' });
    const scheduleId = scheduler.schedule('test-schedule', '1000', handler);
    
    assert.strictEqual(typeof scheduleId, 'string');
    assert.strictEqual(scheduler.schedules.has('test-schedule'), true);
    
    const schedule = scheduler.schedules.get('test-schedule');
    assert.strictEqual(schedule.name, 'test-schedule');
    assert.strictEqual(schedule.interval, 1000);
  });

  test('should throw error when creating duplicate schedule', () => {
    const handler = async () => ({ result: 'ok' });
    scheduler.schedule('duplicate-test', '1000', handler);
    
    assert.throws(() => {
      scheduler.schedule('duplicate-test', '1000', handler);
    }, /Schedule with name "duplicate-test" already exists/);
  });

  test('should throw error when handler is not a function', () => {
    assert.throws(() => {
      scheduler.schedule('invalid-handler', '1000', 'not a function');
    }, /Handler must be a function/);
  });

  test('should get schedule information', () => {
    const handler = async () => ({ result: 'ok' });
    scheduler.schedule('get-test', '2000', handler);
    
    const scheduleInfo = scheduler.getSchedule('get-test');
    
    assert.strictEqual(scheduleInfo.name, 'get-test');
    assert.strictEqual(scheduleInfo.interval, 2000);
    assert.strictEqual(scheduleInfo.isActive, false);
    assert.strictEqual(typeof scheduleInfo.createdAt, 'object');
  });

  test('should return null for non-existent schedule', () => {
    const scheduleInfo = scheduler.getSchedule('non-existent');
    assert.strictEqual(scheduleInfo, null);
  });

  test('should get all schedules', () => {
    const handler = async () => ({ result: 'ok' });
    scheduler.schedule('all-test-1', '3000', handler);
    scheduler.schedule('all-test-2', '4000', handler);
    
    const allSchedules = scheduler.getAllSchedules();
    
    assert.strictEqual(allSchedules.length >= 2, true);
    assert.strictEqual(allSchedules.some(s => s.name === 'all-test-1'), true);
    assert.strictEqual(allSchedules.some(s => s.name === 'all-test-2'), true);
  });

  test('should cancel a schedule', () => {
    const handler = async () => ({ result: 'ok' });
    scheduler.schedule('cancel-test', '5000', handler);
    
    const cancelled = scheduler.cancelSchedule('cancel-test');
    
    assert.strictEqual(cancelled, true);
    assert.strictEqual(scheduler.schedules.has('cancel-test'), false);
  });

  test('should not cancel non-existent schedule', () => {
    const cancelled = scheduler.cancelSchedule('non-existent');
    assert.strictEqual(cancelled, false);
  });

  test('should start the scheduler', () => {
    const handler = async () => ({ result: 'ok' });
    scheduler.schedule('start-test', '10000', handler);
    
    scheduler.start();
    
    assert.strictEqual(scheduler.isRunning, true);
    
    const schedule = scheduler.schedules.get('start-test');
    assert.strictEqual(schedule.intervalId !== null, true);
  });

  test('should stop the scheduler', () => {
    scheduler.start();
    
    scheduler.stop();
    
    assert.strictEqual(scheduler.isRunning, false);
    
    for (const schedule of scheduler.schedules.values()) {
      assert.strictEqual(schedule.intervalId, null);
    }
  });

  test('should parse numeric interval', () => {
    const interval = scheduler._parseInterval('5000');
    assert.strictEqual(interval, 5000);
  });

  test('should parse cron expression for every minute', () => {
    const interval = scheduler._parseInterval('* * * * *');
    assert.strictEqual(interval, 60 * 1000);
  });

  test('should parse cron expression for every hour', () => {
    const interval = scheduler._parseInterval('0 * * * *');
    assert.strictEqual(interval, 60 * 60 * 1000);
  });

  test('should parse cron expression for every day', () => {
    const interval = scheduler._parseInterval('0 0 * * *');
    assert.strictEqual(interval, 24 * 60 * 60 * 1000);
  });

  test('should return -1 for invalid cron expression', () => {
    const interval = scheduler._parseInterval('invalid');
    assert.strictEqual(interval, -1);
  });

  test('should execute scheduled job', async () => {
    let executed = false;
    let executionCount = 0;
    
    const handler = async () => {
      executed = true;
      executionCount++;
      return { result: 'ok' };
    };
    
    scheduler.schedule('exec-test', '100', handler);
    scheduler.start();
    
    // Wait for first execution
    await new Promise(resolve => setTimeout(resolve, 150));
    
    assert.strictEqual(executed, true);
    assert.strictEqual(executionCount, 1);
    
    // Wait for second execution
    await new Promise(resolve => setTimeout(resolve, 100));
    
    assert.strictEqual(executionCount, 2);
    
    scheduler.stop();
  });

  test('should handle handler errors gracefully', async () => {
    let errorLogged = false;
    
    const handler = async () => {
      throw new Error('Handler error');
    };
    
    scheduler.schedule('error-test', '100', handler);
    scheduler.start();
    
    // Wait for execution
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Should not crash, just log error
    assert.strictEqual(scheduler.isRunning, true);
    
    scheduler.stop();
  });

  test('should update run count and timestamps', async () => {
    const handler = async () => ({ result: 'ok' });
    
    scheduler.schedule('timestamp-test', '100', handler);
    scheduler.start();
    
    const schedule = scheduler.schedules.get('timestamp-test');
    
    // Wait for execution
    await new Promise(resolve => setTimeout(resolve, 150));
    
    assert.strictEqual(schedule.runCount > 0, true);
    assert.strictEqual(schedule.lastRun !== null, true);
    assert.strictEqual(schedule.nextRun !== null, true);
    
    scheduler.stop();
  });
});

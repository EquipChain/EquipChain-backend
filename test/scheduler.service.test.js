const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { Scheduler } = require('../src/services/scheduler');

describe('Scheduler Service', () => {
  let scheduler;

  beforeEach(() => {
    scheduler = new Scheduler();
  });

  afterEach(async () => {
    await scheduler.close();
  });

  test('should create a schedule', () => {
    const id = scheduler.schedule('test-job', '60000', async () => {});
    assert.ok(id);
    assert.ok(id.startsWith('schedule_'));
  });

  test('should throw on duplicate schedule name', () => {
    scheduler.schedule('test-job', '60000', async () => {});
    assert.throws(() => {
      scheduler.schedule('test-job', '60000', async () => {});
    }, /Schedule with name "test-job" already exists/);
  });

  test('should throw on non-function handler', () => {
    assert.throws(() => {
      scheduler.schedule('test-job', '60000', 'not-a-function');
    }, /Handler must be a function/);
  });

  test('should get schedule info', () => {
    scheduler.schedule('test-job', '60000', async () => {});
    const info = scheduler.getSchedule('test-job');
    assert.strictEqual(info.name, 'test-job');
    assert.strictEqual(info.interval, 60000);
    assert.strictEqual(info.runCount, 0);
  });

  test('should return null for non-existent schedule', () => {
    const info = scheduler.getSchedule('non-existent');
    assert.strictEqual(info, null);
  });

  test('should get all schedules', () => {
    scheduler.schedule('job-1', '60000', async () => {});
    scheduler.schedule('job-2', '120000', async () => {});
    const all = scheduler.getAllSchedules();
    assert.strictEqual(all.length, 2);
  });

  test('should cancel a schedule', () => {
    scheduler.schedule('test-job', '60000', async () => {});
    const cancelled = scheduler.cancelSchedule('test-job');
    assert.strictEqual(cancelled, true);
    assert.strictEqual(scheduler.getSchedule('test-job'), null);
  });

  test('should return false when cancelling non-existent schedule', () => {
    const cancelled = scheduler.cancelSchedule('non-existent');
    assert.strictEqual(cancelled, false);
  });

  test('should start and stop scheduler', () => {
    scheduler.schedule('test-job', '60000', async () => {});
    scheduler.start();
    assert.strictEqual(scheduler.isRunning, true);
    scheduler.stop();
    assert.strictEqual(scheduler.isRunning, false);
  });

  test('should parse numeric interval', () => {
    scheduler.schedule('test-job', '60000', async () => {});
    const info = scheduler.getSchedule('test-job');
    assert.strictEqual(info.interval, 60000);
  });

  test('should parse cron expressions', () => {
    scheduler.schedule('every-minute', '* * * * *', async () => {});
    scheduler.schedule('every-hour', '0 * * * *', async () => {});
    scheduler.schedule('daily', '0 0 * * *', async () => {});
    scheduler.schedule('weekly', '0 0 * * 1', async () => {});
    scheduler.schedule('monthly', '0 0 1 * *', async () => {});

    assert.strictEqual(scheduler.getSchedule('every-minute').interval, 60000);
    assert.strictEqual(scheduler.getSchedule('every-hour').interval, 3600000);
    assert.strictEqual(scheduler.getSchedule('daily').interval, 86400000);
    assert.strictEqual(scheduler.getSchedule('weekly').interval, 604800000);
  });
});

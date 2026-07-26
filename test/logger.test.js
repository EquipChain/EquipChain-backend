const { describe, it } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const loggerPath = path.join(__dirname, '..', 'src', 'config', 'logger.js');

function runLoggerScript(script, env) {
  const output = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });

  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('logger', () => {
  it('outputs structured JSON logs', () => {
    const script = `
      const { logger } = require(${JSON.stringify(loggerPath)});
      logger.info('hello world');
    `;
    const [entry] = runLoggerScript(script, { NODE_ENV: 'production', LOG_LEVEL: 'info' });

    assert.strictEqual(entry.msg, 'hello world');
    assert.strictEqual(entry.level, 30);
    assert.ok(entry.time);
  });

  it('respects LOG_LEVEL and suppresses lower-priority logs', () => {
    const script = `
      const { logger } = require(${JSON.stringify(loggerPath)});
      logger.info('should not appear');
      logger.error('should appear');
    `;
    const entries = runLoggerScript(script, { NODE_ENV: 'production', LOG_LEVEL: 'error' });

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].msg, 'should appear');
    assert.strictEqual(entries[0].level, 50);
  });

  it('child loggers inherit and extend parent context', () => {
    const script = `
      const { childLogger } = require(${JSON.stringify(loggerPath)});
      const log = childLogger('test-module');
      log.info('from child');
    `;
    const [entry] = runLoggerScript(script, { NODE_ENV: 'production', LOG_LEVEL: 'info' });

    assert.strictEqual(entry.module, 'test-module');
    assert.strictEqual(entry.msg, 'from child');
  });
});

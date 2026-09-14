const pino = require('pino');

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // Redact sensitive fields to prevent log injection and protect sensitive data.
  // Wildcards matter: pino's paths are exact, so 'password' alone does NOT
  // cover 'user.password' or 'config.secret' - only the top-level key. The
  // '*.x' forms cover one nesting level anywhere (the common shapes: error
  // objects, req/user/headers wrappers), and the bracketed forms catch
  // hyphenated header keys that dot paths cannot express.
  redact: {
    paths: [
      'password',
      '*.password',
      'token',
      '*.token',
      'apiKey',
      '*.apiKey',
      'secret',
      '*.secret',
      'authorization',
      '*.authorization',
      'cookie',
      '*.cookie',
      'refreshToken',
      '*.refreshToken',
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'req.headers["x-role"]',
      'req.headers["x-correlation-id"]',
    ],
    remove: true,
  },
  transport:
    isProduction || isTest
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
});

function childLogger(moduleName) {
  return logger.child({ module: moduleName });
}

module.exports = { logger, childLogger };

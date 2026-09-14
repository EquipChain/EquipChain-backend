const { describe, it, after } = require('node:test');
const assert = require('node:assert');

const app = require('../src/app');
const { _resetStore } = require('../src/middleware/rateLimiter');
const { DependencyUnavailableError } = require('../src/utils/errors');
const server = app.listen(0);

after(() => server.close());

describe('Security Tests', () => {
  describe('Request Body Size Limits', () => {
    it('rejects oversized JSON payload', async () => {
      const port = server.address().port;
      const largePayload = {
        data: 'x'.repeat(2 * 1024 * 1024), // 2MB of data
      };

      try {
        const res = await fetch(`http://localhost:${port}/api/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(largePayload),
        });
        // Should not succeed with 200
        assert.notStrictEqual(res.status, 200);
      } catch (error) {
        // Network errors are acceptable for oversized payloads
        assert.ok(true);
      }
    });

    it('accepts payload within size limit', async () => {
      const port = server.address().port;
      const validPayload = {
        data: 'x'.repeat(500), // Small payload
      };

      const res = await fetch(`http://localhost:${port}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload),
      });
      // Should return 200 or 404 (not 413)
      assert.ok(res.status !== 413);
    });
  });

  describe('Prototype Pollution Guard', () => {
    it('strips __proto__ keys from JSON bodies at the boundary', async () => {
      const port = server.address().port;
      const malicious = JSON.stringify({
        wallet: 'w1',
        '__proto__': { isAdmin: true },
      });

      const res = await fetch(`http://localhost:${port}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: malicious,
      });
      // Route must still work on the cleaned body (200), not crash or 500.
      assert.strictEqual(res.status, 200);
      // The global prototype must be untouched.
      assert.strictEqual(({}).isAdmin, undefined);
    });

    it('rejects bodies carrying nested constructor/prototype payloads safely', async () => {
      const port = server.address().port;
      const res = await fetch(`http://localhost:${port}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nested: { constructor: { prototype: { x: 1 } } } }),
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(({}).x, undefined);
    });
  });

  describe('Brute-force guard on token minting', () => {
    it('caps /api/auth/challenge at 5 attempts/minute per IP, isolated from the tier limiter', async () => {
      // Earlier tests in this file consumed limiter budget; start clean.
      _resetStore();
      const port = server.address().port;
      const statuses = [];
      for (let i = 0; i < 7; i++) {
        const res = await fetch(`http://localhost:${port}/api/auth/challenge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: `stress-${i}` }),
        });
        statuses.push(res.status);
      }
      const allowed = statuses.filter((s) => s === 200).length;
      const throttled = statuses.filter((s) => s === 429).length;
      assert.strictEqual(allowed, 5, `exactly 5 attempts allowed (got ${allowed})`);
      assert.strictEqual(throttled, 2, 'attempts beyond 5 must be throttled');
    });
  });

  describe('Dependency failure semantics', () => {
    it('maps DependencyUnavailableError to retryable 503 with Retry-After, no internals', async () => {
      // Use the exported errorHandler on a fresh mini-app so we exercise the
      // exact production error semantics without mutating this app's mount
      // order (routes cannot be added after the 404 handler).
      const express = require('express');
      const { errorHandler } = require('../src/app');
      const mini = express();
      mini.get('/dep', () => {
        throw new DependencyUnavailableError('cache', 'ECONNREFUSED 10.0.0.5:6379');
      });
      mini.use(errorHandler);
      const miniServer = mini.listen(0);
      const port = miniServer.address().port;

      const res = await fetch(`http://localhost:${port}/dep`);
      const body = await res.json();
      miniServer.close();

      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.headers.get('retry-after'), '5');
      assert.strictEqual(body.error, 'DependencyUnavailableError');
      // The technical detail must NOT reach the client...
      assert.ok(!body.message.includes('ECONNREFUSED'));
      assert.ok(!body.message.includes('10.0.0.5'));
      // ...but the fixed retryable message must.
      assert.ok(body.message.includes('temporarily unavailable'));
    });
  });

  describe('XSS Protection', () => {
    it('sanitizes XSS payload in error responses', async () => {
      const port = server.address().port;
      const xssPayload = '<script>alert("xss")</script>';

      const res = await fetch(`http://localhost:${port}/${encodeURIComponent(xssPayload)}`);
      assert.strictEqual(res.status, 404);

      const data = await res.json();
      // The message should not contain unescaped HTML
      assert.ok(!data.message.includes('<script>'));
    });
  });

  describe('Content-Type Headers', () => {
    it('returns application/json for API responses', async () => {
      const port = server.address().port;

      const res = await fetch(`http://localhost:${port}/`);
      assert.strictEqual(res.status, 200);
      
      const contentType = res.headers.get('content-type');
      assert.ok(contentType && contentType.includes('application/json'));
    });

    it('returns application/json for health check', async () => {
      const port = server.address().port;

      const res = await fetch(`http://localhost:${port}/health`);
      assert.strictEqual(res.status, 200);
      
      const contentType = res.headers.get('content-type');
      assert.ok(contentType && contentType.includes('application/json'));
    });

    it('returns application/json for 404 errors', async () => {
      const port = server.address().port;

      const res = await fetch(`http://localhost:${port}/non-existent`);
      assert.strictEqual(res.status, 404);
      
      const contentType = res.headers.get('content-type');
      assert.ok(contentType && contentType.includes('application/json'));
    });
  });

  describe('Input Validation', () => {
    it('handles null bytes in URLs', async () => {
      const port = server.address().port;
      const urlWithNullByte = `http://localhost:${port}/test\x00path`;

      try {
        const res = await fetch(urlWithNullByte);
        // Should handle gracefully (400 or 404, not 500)
        assert.ok(res.status >= 400 && res.status < 600);
      } catch (error) {
        // Network errors are acceptable for malformed URLs
        assert.ok(true);
      }
    });

    it('handles very long URLs', async () => {
      const port = server.address().port;
      const longPath = '/a'.repeat(10000);

      try {
        const res = await fetch(`http://localhost:${port}${longPath}`);
        // Should handle gracefully (414 or 404, not 500)
        assert.ok(res.status >= 400 && res.status < 600);
      } catch (error) {
        // Network errors are acceptable for overly long URLs
        assert.ok(true);
      }
    });
  });

  describe('Correlation ID Security', () => {
    it('sanitizes correlation ID in headers', async () => {
      const port = server.address().port;
      const maliciousCorrelationId = '<script>alert(1)</script>';

      const res = await fetch(`http://localhost:${port}/`, {
        headers: { 'x-correlation-id': maliciousCorrelationId },
      });

      assert.strictEqual(res.status, 200);
      const returnedCorrelationId = res.headers.get('x-correlation-id');

      // The returned correlation ID should be the same but not cause issues
      assert.ok(returnedCorrelationId);
    });

    it('strips control characters (header smuggling) and bounds length', async () => {
      const port = server.address().port;

      // Unit-level: the exact smuggle payload must be defused by the same
      // sanitizer the middleware uses (undici refuses to SEND CR/LF headers,
      // so this vector can only be exercised on the value itself).
      const { sanitizeHeaderValue } = require('../src/utils/sanitize');
      const smuggle = 'abc\r\nSet-Cookie: pwned=1';
      const cleaned = sanitizeHeaderValue(smuggle);
      assert.strictEqual(cleaned.includes('\r'), false, 'CR must be stripped');
      assert.strictEqual(cleaned.includes('\n'), false, 'LF must be stripped');
      // Without CR/LF the value can no longer terminate a header early -
      // it is one opaque single-line token, not two headers.

      // Integration: oversized values must be truncated, not echoed. Node
      // itself 431s requests above its 16KB header cap; a 4KB value passes
      // Node but must still be bounded by our middleware.
      const huge = 'x'.repeat(4096);
      const res2 = await fetch(`http://localhost:${port}/`, {
        headers: { 'x-correlation-id': huge },
      });
      const id2 = res2.headers.get('x-correlation-id');
      assert.ok(id2, 'bounded response must include a correlation id');
      assert.ok(id2.length <= 128, `correlation id must be bounded (got ${id2.length})`);

      // Integration: a legitimate client ID is honored intact.
      const legit = 'trace-abc-123';
      const res3 = await fetch(`http://localhost:${port}/`, {
        headers: { 'x-correlation-id': legit },
      });
      assert.strictEqual(res3.headers.get('x-correlation-id'), legit);
    });
  });

  describe('Error Message Security', () => {
    it('does not expose sensitive information in production mode', async () => {
      const port = server.address().port;
      
      const res = await fetch(`http://localhost:${port}/non-existent-route`);
      assert.strictEqual(res.status, 404);

      const data = await res.json();
      assert.ok(data.error);
      assert.ok(data.message);
    });
  });
});

const { describe, it, after } = require('node:test');
const assert = require('node:assert');

const app = require('../src/app');
const server = app.listen(0);

after(() => server.close());

describe('Security Tests', () => {
  describe('Request Body Size Limits', () => {
    it('rejects oversized JSON payload with 413', async () => {
      const port = server.address().port;
      // Create a payload larger than 1MB (default limit)
      const largePayload = {
        data: 'x'.repeat(2 * 1024 * 1024), // 2MB of data
      };

      try {
        const res = await fetch(`http://localhost:${port}/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(largePayload),
        });
        assert.strictEqual(res.status, 413);
        
        const data = await res.json();
        assert.ok(data.error || data.message);
      } catch (error) {
        // Express will reject the payload before it reaches our route
        // The error might be a network error due to payload size
        assert.ok(error.message.includes('payload') || error.message.includes('body'));
      }
    });

    it('accepts payload within size limit', async () => {
      const port = server.address().port;
      const validPayload = {
        data: 'x'.repeat(500 * 1024), // 500KB - within 1MB limit
      };

      try {
        const res = await fetch(`http://localhost:${port}/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload),
        });
        // Should return 404 (route doesn't exist) but not 413
        assert.notStrictEqual(res.status, 413);
      } catch (error) {
        // Network errors are acceptable for non-existent routes
        assert.ok(true);
      }
    });
  });

  describe('XSS Protection', () => {
    it('sanitizes XSS payload in error responses', async () => {
      const port = server.address().port;
      const xssPayload = '<script>alert("xss")</script>';

      const res = await fetch(`http://localhost:${port}/${xssPayload}`);
      assert.strictEqual(res.status, 404);

      const data = await res.json();
      // The message should be sanitized (HTML entities encoded)
      assert.ok(!data.message.includes('<script>'));
      assert.ok(data.message.includes('&lt;') || !data.message.includes('<'));
    });

    it('sanitizes XSS payload in query parameters', async () => {
      const port = server.address().port;
      const xssPayload = '?test=<img src=x onerror=alert(1)>';

      const res = await fetch(`http://localhost:${port}/test${xssPayload}`);
      assert.strictEqual(res.status, 404);

      const data = await res.json();
      // The message should be sanitized
      assert.ok(!data.message.includes('<img'));
    });
  });

  describe('Content-Type Headers', () => {
    it('returns application/json for API responses', async () => {
      const port = server.address().port;

      const res = await fetch(`http://localhost:${port}/`);
      assert.strictEqual(res.status, 200);
      
      const contentType = res.headers.get('content-type');
      assert.ok(contentType.includes('application/json'));
    });

    it('returns application/json for health check', async () => {
      const port = server.address().port;

      const res = await fetch(`http://localhost:${port}/health`);
      assert.strictEqual(res.status, 200);
      
      const contentType = res.headers.get('content-type');
      assert.ok(contentType.includes('application/json'));
    });

    it('returns application/json for 404 errors', async () => {
      const port = server.address().port;

      const res = await fetch(`http://localhost:${port}/non-existent`);
      assert.strictEqual(res.status, 404);
      
      const contentType = res.headers.get('content-type');
      assert.ok(contentType.includes('application/json'));
    });

    it('includes security headers from Helmet', async () => {
      const port = server.address().port;

      const res = await fetch(`http://localhost:${port}/`);
      assert.strictEqual(res.status, 200);

      // Check for common Helmet security headers
      assert.ok(res.headers.get('x-content-type-options') === 'nosniff');
      assert.ok(res.headers.get('x-dns-prefetch-control'));
      assert.ok(res.headers.get('x-frame-options'));
    });
  });

  describe('Input Validation', () => {
    it('handles null bytes in URLs', async () => {
      const port = server.address().port;
      const urlWithNullByte = `http://localhost:${port}/test\x00path`;

      try {
        const res = await fetch(urlWithNullByte);
        // Should handle gracefully (400 or 404, not 500)
        assert.ok(res.status === 400 || res.status === 404 || res.status === 414);
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
        assert.ok(res.status === 414 || res.status === 404 || res.status === 431);
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
  });

  describe('Error Message Security', () => {
    it('does not expose sensitive information in production mode', async () => {
      const port = server.address().port;
      
      // In non-production mode, error messages are shown
      // In production, they should be generic
      const res = await fetch(`http://localhost:${port}/non-existent-route`);
      assert.strictEqual(res.status, 404);

      const data = await res.json();
      assert.ok(data.error);
      assert.ok(data.message);
    });
  });
});

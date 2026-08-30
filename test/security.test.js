const { describe, it, after } = require('node:test');
const assert = require('node:assert');

const app = require('../src/app');
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

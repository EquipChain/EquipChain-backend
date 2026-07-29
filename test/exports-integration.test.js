const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

describe('Export Endpoints Integration Tests', () => {
  let server;
  const PORT = 3456; // Use different port for tests

  before(async () => {
    // Start the server for testing
    process.env.PORT = PORT;
    process.env.NODE_ENV = 'test';
    
    const app = require('../src/app');
    server = app.listen(PORT);
    
    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  after(() => {
    if (server) {
      server.close();
    }
  });

  function makeRequest(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, `http://localhost:${PORT}`);
      
      const requestOptions = {
        hostname: 'localhost',
        port: PORT,
        path: url.pathname + url.search,
        method: options.method || 'GET',
        headers: options.headers || {},
      };

      const req = http.request(requestOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data,
          });
        });
      });

      req.on('error', reject);
      
      if (options.body) {
        req.write(options.body);
      }
      
      req.end();
    });
  }

  describe('GET /api/exports/readings', () => {
    test('should return 401 without authentication', async () => {
      const response = await makeRequest('/api/exports/readings?format=csv');
      assert.strictEqual(response.statusCode, 401);
    });

    test('should return CSV with valid authentication', async () => {
      const response = await makeRequest('/api/exports/readings?format=csv', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.headers['content-type'], 'text/csv; charset=utf-8');
      assert.ok(response.headers['content-disposition'].includes('attachment'));
      assert.ok(response.headers['content-disposition'].includes('meter-readings'));
      assert.ok(response.body.includes('id,meterId,timestamp,value,unit,status'));
    });

    test('should return JSON when format=json', async () => {
      const response = await makeRequest('/api/exports/readings?format=json', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.headers['content-type'], 'application/json; charset=utf-8');
      
      const data = JSON.parse(response.body);
      assert.ok(Array.isArray(data));
      assert.ok(data.length > 0);
    });

    test('should return NDJSON when format=ndjson', async () => {
      const response = await makeRequest('/api/exports/readings?format=ndjson', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.headers['content-type'], 'application/x-ndjson; charset=utf-8');
      
      const lines = response.body.trim().split('\n');
      assert.ok(lines.length > 0);
      lines.forEach(line => {
        JSON.parse(line); // Should not throw
      });
    });

    test('should filter by fields parameter', async () => {
      const response = await makeRequest('/api/exports/readings?format=csv&fields=id,meterId,value', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 200);
      assert.ok(response.body.includes('id,meterId,value'));
      assert.ok(!response.body.includes('timestamp'));
      assert.ok(!response.body.includes('unit'));
    });

    test('should return 400 for invalid fields', async () => {
      const response = await makeRequest('/api/exports/readings?format=csv&fields=invalid,nonexistent', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 400);
      const data = JSON.parse(response.body);
      assert.ok(data.error.includes('Invalid fields'));
    });

    test('should filter by meterIds', async () => {
      const response = await makeRequest('/api/exports/readings?format=json&meterIds=meter-001', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 200);
      const data = JSON.parse(response.body);
      data.forEach(reading => {
        assert.strictEqual(reading.meterId, 'meter-001');
      });
    });

    test('should filter by date range', async () => {
      const response = await makeRequest('/api/exports/readings?format=json&startDate=2026-01-15&endDate=2026-01-15', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 200);
      const data = JSON.parse(response.body);
      data.forEach(reading => {
        const date = reading.timestamp.split('T')[0];
        assert.strictEqual(date, '2026-01-15');
      });
    });

    test('should include date range in filename', async () => {
      const response = await makeRequest('/api/exports/readings?format=csv&startDate=2026-01-01&endDate=2026-06-01', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 200);
      assert.ok(response.headers['content-disposition'].includes('2026-01-01-to-2026-06-01'));
    });

    test('should return 400 for invalid format', async () => {
      const response = await makeRequest('/api/exports/readings?format=xml', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 400);
    });
  });

  describe('GET /api/exports/analytics/:summaryType', () => {
    test('should return 401 without authentication', async () => {
      const response = await makeRequest('/api/exports/analytics/daily');
      assert.strictEqual(response.statusCode, 401);
    });

    test('should return daily analytics', async () => {
      const response = await makeRequest('/api/exports/analytics/daily?format=csv', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 200);
      assert.ok(response.body.includes('date,totalConsumption'));
    });

    test('should return weekly analytics', async () => {
      const response = await makeRequest('/api/exports/analytics/weekly?format=json', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.ok(Array.isArray(data));
    });

    test('should return monthly analytics', async () => {
      const response = await makeRequest('/api/exports/analytics/monthly?format=json', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.ok(Array.isArray(data));
    });

    test('should return 400 for invalid summary type', async () => {
      const response = await makeRequest('/api/exports/analytics/invalid', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 400);
      const data = JSON.parse(response.body);
      assert.ok(data.error.includes('Invalid summary type'));
    });

    test('should filter daily analytics by date range', async () => {
      const response = await makeRequest('/api/exports/analytics/daily?format=json&startDate=2026-01-15&endDate=2026-01-16', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 200);
      const data = JSON.parse(response.body);
      data.forEach(item => {
        assert.ok(item.date >= '2026-01-15');
        assert.ok(item.date <= '2026-01-16');
      });
    });
  });

  describe('GET /api/exports/system-report', () => {
    test('should return 401 without authentication', async () => {
      const response = await makeRequest('/api/exports/system-report');
      assert.strictEqual(response.statusCode, 401);
    });

    test('should return 403 without admin role', async () => {
      const response = await makeRequest('/api/exports/system-report', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 403);
    });

    test('should return system report with admin role', async () => {
      const response = await makeRequest('/api/exports/system-report?format=json', {
        headers: { 
          Authorization: 'Bearer test-token',
          'x-role': 'admin',
        },
      });
      
      assert.strictEqual(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.ok(data.meters);
      assert.ok(data.readings);
      assert.ok(data.alerts);
      assert.ok(data.summary);
    });

    test('should filter sections', async () => {
      const response = await makeRequest('/api/exports/system-report?format=json&sections=meters,summary', {
        headers: { 
          Authorization: 'Bearer test-token',
          'x-role': 'admin',
        },
      });
      
      assert.strictEqual(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.ok(data.meters);
      assert.ok(data.summary);
      assert.ok(!data.readings);
      assert.ok(!data.alerts);
    });

    test('should handle CSV format for system report', async () => {
      const response = await makeRequest('/api/exports/system-report?format=csv', {
        headers: { 
          Authorization: 'Bearer test-token',
          'x-role': 'admin',
        },
      });
      
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.headers['content-type'], 'text/csv; charset=utf-8');
      assert.ok(response.body.includes('_section'));
    });
  });

  describe('GET /api/exports/meters', () => {
    test('should return 401 without authentication', async () => {
      const response = await makeRequest('/api/exports/meters');
      assert.strictEqual(response.statusCode, 401);
    });

    test('should return meters with valid authentication', async () => {
      const response = await makeRequest('/api/exports/meters?format=csv', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 200);
      assert.ok(response.body.includes('id,name,location,status'));
    });

    test('should filter by status', async () => {
      const response = await makeRequest('/api/exports/meters?format=json&status=online', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 200);
      const data = JSON.parse(response.body);
      data.forEach(meter => {
        assert.strictEqual(meter.status, 'online');
      });
    });

    test('should filter by location', async () => {
      const response = await makeRequest('/api/exports/meters?format=json&location=Building A', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 200);
      const data = JSON.parse(response.body);
      data.forEach(meter => {
        assert.strictEqual(meter.location, 'Building A');
      });
    });
  });

  describe('Streaming and Performance', () => {
    test('should set Transfer-Encoding: chunked', async () => {
      const response = await makeRequest('/api/exports/readings?format=csv', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.headers['transfer-encoding'], 'chunked');
    });

    test('should handle pretty-printed JSON', async () => {
      const response = await makeRequest('/api/exports/readings?format=json&pretty=true', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 200);
      assert.ok(response.body.includes('\n'));
    });

    test('should return empty file for no data', async () => {
      // This test would require modifying the mock to return empty data
      // For now, we just verify the endpoint handles the request
      const response = await makeRequest('/api/exports/readings?format=csv&meterIds=nonexistent', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 200);
      assert.ok(response.headers['content-disposition'].includes('attachment'));
    });
  });

  describe('Error Handling', () => {
    test('should return 400 for malformed fields parameter', async () => {
      const response = await makeRequest('/api/exports/readings?format=csv&fields=invalid', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      assert.strictEqual(response.statusCode, 400);
    });

    test('should handle invalid date format gracefully', async () => {
      const response = await makeRequest('/api/exports/readings?format=csv&startDate=invalid-date', {
        headers: { Authorization: 'Bearer test-token' },
      });
      
      // Should not crash - may return empty results or error
      assert.ok([200, 400].includes(response.statusCode));
    });

    test('should reject invalid authentication format', async () => {
      const response = await makeRequest('/api/exports/readings?format=csv', {
        headers: { Authorization: 'InvalidFormat token' },
      });
      
      assert.strictEqual(response.statusCode, 401);
    });
  });
});

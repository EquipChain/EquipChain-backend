const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const jwt = require('jsonwebtoken');

describe('Export Endpoints Integration Tests', () => {
  let server;
  const PORT = 3456; // Use different port for tests

  before(async () => {
    // Start the server for testing
    process.env.PORT = PORT;
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-exports-integration';

    // Exports now enforce real JWT auth (previously ANY Bearer token was
    // accepted). Mint short-lived tokens for a regular user and an admin.
    const signToken = (roles) =>
      jwt.sign({ sub: 'export-tester', roles }, process.env.JWT_SECRET, { expiresIn: '1h' });
    var userToken = signToken(['user']);
    var adminToken = signToken(['admin']);
    global.userToken = userToken;
    global.adminToken = adminToken;

    const app = require('../src/app');
    server = app.listen(PORT);

    // Seed the REAL stores the exports now read from. Exports previously
    // served hardcoded mock arrays; they now read the aggregator's readings
    // store and the admin device registry, so the tests seed those stores
    // directly and assert against seeded values.
    const aggregator = require('../src/services/aggregator');
    const { deviceStore } = require('../src/data/adminStore');
    aggregator.clearReadings();
    deviceStore._reset();

    aggregator.addReadings([
      { meterId: 'meter-001', timestamp: '2026-01-15T08:00:00Z', value: 100, unit: 'kWh' },
      { meterId: 'meter-001', timestamp: '2026-01-15T09:00:00Z', value: 150, unit: 'kWh' },
      { meterId: 'meter-001', timestamp: '2026-01-16T08:00:00Z', value: 200, unit: 'kWh' },
      { meterId: 'meter-002', timestamp: '2026-01-15T08:00:00Z', value: 50, unit: 'kWh' },
      { meterId: 'meter-002', timestamp: '2026-01-16T09:00:00Z', value: 75, unit: 'kWh' },
    ]);

    deviceStore.create({ deviceId: 'meter-001', name: 'Main Building Meter', location: 'Building A' });
    deviceStore.create({ deviceId: 'meter-002', name: 'Auxiliary Meter', location: 'Building B' });

    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  after(() => {
    if (server) {
      server.close();
    }
    // Stores are module-global; reset so other test files are unaffected.
    require('../src/services/aggregator').clearReadings();
    require('../src/data/adminStore').deviceStore._reset();
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
        headers: { Authorization: `Bearer ${global.userToken}` },
      });
      
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.headers['content-type'], 'text/csv; charset=utf-8');
      assert.ok(response.headers['content-disposition'].includes('attachment'));
      assert.ok(response.headers['content-disposition'].includes('meter-readings'));
      // Real reading shape: no fabricated 'status' column.
      assert.ok(response.body.includes('id,meterId,timestamp,value,unit,createdAt'));
      // Seeded rows are present in the export.
      assert.ok(response.body.includes('meter-001'));
      assert.ok(response.body.includes('100'));
    });

    test('should return JSON when format=json', async () => {
      const response = await makeRequest('/api/exports/readings?format=json', {
        headers: { Authorization: `Bearer ${global.userToken}` },
      });
      
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.headers['content-type'], 'application/json; charset=utf-8');
      
      const data = JSON.parse(response.body);
      assert.ok(Array.isArray(data));
      assert.ok(data.length > 0);
    });

    test('should return NDJSON when format=ndjson', async () => {
      const response = await makeRequest('/api/exports/readings?format=ndjson', {
        headers: { Authorization: `Bearer ${global.userToken}` },
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
        headers: { Authorization: `Bearer ${global.userToken}` },
      });
      
      assert.strictEqual(response.statusCode, 200);
      assert.ok(response.body.includes('id,meterId,value'));
      assert.ok(!response.body.includes('timestamp'));
      assert.ok(!response.body.includes('unit'));
    });

    test('should return 400 for invalid fields', async () => {
      const response = await makeRequest('/api/exports/readings?format=csv&fields=invalid,nonexistent', {
        headers: { Authorization: `Bearer ${global.userToken}` },
      });
      
      assert.strictEqual(response.statusCode, 400);
      const data = JSON.parse(response.body);
      assert.ok(data.error.includes('Invalid fields'));
    });

    test('should filter by meterIds', async () => {
      const response = await makeRequest('/api/exports/readings?format=json&meterIds=meter-001', {
        headers: { Authorization: `Bearer ${global.userToken}` },
      });
      
      assert.strictEqual(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.ok(data.length > 0, 'seeded meter-001 rows must be exported');
      data.forEach(reading => {
        assert.strictEqual(reading.meterId, 'meter-001');
      });
    });

    test('should filter by date range', async () => {
      const response = await makeRequest('/api/exports/readings?format=json&startDate=2026-01-15&endDate=2026-01-15', {
        headers: { Authorization: `Bearer ${global.userToken}` },
      });
      
      assert.strictEqual(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.ok(data.length > 0, 'seeded 2026-01-15 rows must be exported');
      data.forEach(reading => {
        const date = reading.timestamp.split('T')[0];
        assert.strictEqual(date, '2026-01-15');
      });
    });

    test('should include date range in filename', async () => {
      const response = await makeRequest('/api/exports/readings?format=csv&startDate=2026-01-01&endDate=2026-06-01', {
        headers: { Authorization: `Bearer ${global.userToken}` },
      });
      
      assert.strictEqual(response.statusCode, 200);
      assert.ok(response.headers['content-disposition'].includes('2026-01-01-to-2026-06-01'));
    });

    test('should return 400 for invalid format', async () => {
      const response = await makeRequest('/api/exports/readings?format=xml', {
        headers: { Authorization: `Bearer ${global.userToken}` },
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
        headers: { Authorization: `Bearer ${global.userToken}` },
      });
      
      assert.strictEqual(response.statusCode, 200);
      assert.ok(response.body.includes('date'));
      assert.ok(response.body.includes('totalConsumption'));
      // Computed from seeded readings: 2026-01-15 has 100+150+50 = 300.
      assert.ok(response.body.includes('2026-01-15'));
    });

    test('should return weekly analytics', async () => {
      const response = await makeRequest('/api/exports/analytics/weekly?format=json', {
        headers: { Authorization: `Bearer ${global.userToken}` },
      });
      
      assert.strictEqual(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.ok(Array.isArray(data));
      assert.ok(data.length > 0, 'seeded readings must produce one weekly bucket');
      assert.strictEqual(data[0].weekStart, '2026-01-12'); // Monday of the seed week (Jan 15 2026 is a Thursday)
    });

    test('should return monthly analytics', async () => {
      const response = await makeRequest('/api/exports/analytics/monthly?format=json', {
        headers: { Authorization: `Bearer ${global.userToken}` },
      });
      
      assert.strictEqual(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.ok(Array.isArray(data));
      assert.ok(data.length > 0);
      assert.strictEqual(data[0].month, '2026-01');
    });

    test('should return 400 for invalid summary type', async () => {
      const response = await makeRequest('/api/exports/analytics/invalid', {
        headers: { Authorization: `Bearer ${global.userToken}` },
      });
      
      assert.strictEqual(response.statusCode, 400);
      const data = JSON.parse(response.body);
      // Params validation reports the offending field through the standard
      // validation error envelope ({ error, details:[{ location, path }] }).
      assert.ok(
        (data.details || []).some(
          (d) => d.location === 'params' && d.path === 'summaryType'
        ),
        `expected params.summaryType validation failure, got: ${JSON.stringify(data)}`
      );
    });

    test('should filter daily analytics by date range', async () => {
      const response = await makeRequest('/api/exports/analytics/daily?format=json&startDate=2026-01-15&endDate=2026-01-16', {
        headers: { Authorization: `Bearer ${global.userToken}` },
      });
      
      assert.strictEqual(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.ok(data.length > 0);
      data.forEach(item => {
        assert.ok(item.date >= '2026-01-15');
        assert.ok(item.date <= '2026-01-16');
      });
      // 2026-01-15: 100+150+50 = 300; 2026-01-16: 200+75 = 275.
      const d15 = data.find((d) => d.date === '2026-01-15');
      const d16 = data.find((d) => d.date === '2026-01-16');
      assert.strictEqual(d15.totalConsumption, 300);
      assert.strictEqual(d16.totalConsumption, 275);
    });
  });

  describe('GET /api/exports/system-report', () => {
    test('should return 401 without authentication', async () => {
      const response = await makeRequest('/api/exports/system-report');
      assert.strictEqual(response.statusCode, 401);
    });

    test('should return 403 without admin role', async () => {
      const response = await makeRequest('/api/exports/system-report', {
        headers: { Authorization: `Bearer ${global.userToken}` },
      });
      
      assert.strictEqual(response.statusCode, 403);
    });

    test('should return system report with admin role', async () => {
      const response = await makeRequest('/api/exports/system-report?format=json', {
        headers: { 
          Authorization: `Bearer ${global.adminToken}`,
        },
      });
      
      assert.strictEqual(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.ok(data.meters);
      assert.ok(data.readings);
      assert.ok(data.alerts);
      assert.ok(data.summary);
      // Real data: 2 registered devices, 5 seeded readings, honest empty alerts.
      assert.strictEqual(data.meters.length, 2);
      assert.strictEqual(data.readings.length, 5);
      assert.deepStrictEqual(data.alerts, []);
      assert.strictEqual(data.summary.totalMeters, 2);
      assert.strictEqual(data.summary.totalReadings, 5);
    });

    test('should filter sections', async () => {
      const response = await makeRequest('/api/exports/system-report?format=json&sections=meters,summary', {
        headers: { 
          Authorization: `Bearer ${global.adminToken}`,
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
          Authorization: `Bearer ${global.adminToken}`,
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
        headers: { Authorization: `Bearer ${global.userToken}` },
      });
      
      assert.strictEqual(response.statusCode, 200);
      // Real device registry shape.
      assert.ok(response.body.includes('id,deviceId,name,location,registeredAt'));
      assert.ok(response.body.includes('Main Building Meter'));
    });

    test('should filter by status (registry has no status; matches nothing)', async () => {
      // The real device registry tracks no 'status' field - the filter stays
      // for contract stability and honestly selects nothing.
      const response = await makeRequest('/api/exports/meters?format=json&status=online', {
        headers: { Authorization: `Bearer ${global.userToken}` },
      });
      
      assert.strictEqual(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.deepStrictEqual(data, []);
    });

    test('should filter by location', async () => {
      const response = await makeRequest('/api/exports/meters?format=json&location=Building A', {
        headers: { Authorization: `Bearer ${global.userToken}` },
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
        headers: { Authorization: `Bearer ${global.userToken}` },
      });
      
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.headers['transfer-encoding'], 'chunked');
    });

    test('should handle pretty-printed JSON', async () => {
      const response = await makeRequest('/api/exports/readings?format=json&pretty=true', {
        headers: { Authorization: `Bearer ${global.userToken}` },
      });
      
      assert.strictEqual(response.statusCode, 200);
      assert.ok(response.body.includes('\n'));
    });

    test('should return empty file for no data', async () => {
      // This test would require modifying the mock to return empty data
      // For now, we just verify the endpoint handles the request
      const response = await makeRequest('/api/exports/readings?format=csv&meterIds=nonexistent', {
        headers: { Authorization: `Bearer ${global.userToken}` },
      });
      
      assert.strictEqual(response.statusCode, 200);
      assert.ok(response.headers['content-disposition'].includes('attachment'));
    });
  });

  describe('Error Handling', () => {
    test('should return 400 for malformed fields parameter', async () => {
      const response = await makeRequest('/api/exports/readings?format=csv&fields=invalid', {
        headers: { Authorization: `Bearer ${global.userToken}` },
      });
      
      assert.strictEqual(response.statusCode, 400);
    });

    test('should handle invalid date format gracefully', async () => {
      const response = await makeRequest('/api/exports/readings?format=csv&startDate=invalid-date', {
        headers: { Authorization: `Bearer ${global.userToken}` },
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

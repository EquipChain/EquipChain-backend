const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { Readable } = require('stream');
const {
  generateFilename,
  validateFormat,
  validateFields,
  exportToCSV,
  exportToJSON,
  setExportHeaders,
  SUPPORTED_FORMATS,
} = require('../src/services/exporter');

describe('Exporter Service', () => {
  
  describe('generateFilename', () => {
    test('should generate filename with date range', () => {
      const filename = generateFilename('readings', '2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z', 'csv');
      assert.strictEqual(filename, 'readings-2026-01-01-to-2026-06-01.csv');
    });

    test('should generate filename without date range', () => {
      const filename = generateFilename('readings', null, null, 'csv');
      assert.strictEqual(filename, 'readings.csv');
    });

    test('should use json extension for ndjson format', () => {
      const filename = generateFilename('analytics', '2026-01-01', '2026-01-31', 'ndjson');
      assert.strictEqual(filename, 'analytics-2026-01-01-to-2026-01-31.json');
    });

    test('should handle single date', () => {
      const filename = generateFilename('meters', '2026-01-01', null, 'json');
      assert.strictEqual(filename, 'meters-2026-01-01-to-all.json');
    });
  });

  describe('validateFormat', () => {
    test('should accept valid formats', () => {
      assert.strictEqual(validateFormat('csv'), 'csv');
      assert.strictEqual(validateFormat('CSV'), 'csv');
      assert.strictEqual(validateFormat('json'), 'json');
      assert.strictEqual(validateFormat('ndjson'), 'ndjson');
    });

    test('should throw error for invalid format', () => {
      assert.throws(() => validateFormat('xml'), /Invalid format 'xml'/);
      assert.throws(() => validateFormat('pdf'), /Invalid format 'pdf'/);
      assert.throws(() => validateFormat(''), /Invalid format/);
    });

    test('should list supported formats in error message', () => {
      try {
        validateFormat('invalid');
        assert.fail('Should have thrown error');
      } catch (error) {
        assert.ok(error.message.includes('csv'));
        assert.ok(error.message.includes('json'));
        assert.ok(error.message.includes('ndjson'));
      }
    });
  });

  describe('validateFields', () => {
    const availableFields = ['id', 'name', 'value', 'timestamp'];

    test('should return all fields when none requested', () => {
      const result = validateFields(null, availableFields);
      assert.deepStrictEqual(result, availableFields);
    });

    test('should return all fields when empty array requested', () => {
      const result = validateFields([], availableFields);
      assert.deepStrictEqual(result, availableFields);
    });

    test('should return only requested valid fields', () => {
      const result = validateFields(['id', 'name'], availableFields);
      assert.deepStrictEqual(result, ['id', 'name']);
    });

    test('should throw error for invalid fields', () => {
      assert.throws(() => validateFields(['id', 'invalid'], availableFields), /Invalid fields requested/);
    });

    test('should list invalid fields in error message', () => {
      try {
        validateFields(['id', 'nonexistent', 'invalid'], availableFields);
        assert.fail('Should have thrown error');
      } catch (error) {
        assert.ok(error.message.includes('nonexistent'));
        assert.ok(error.message.includes('invalid'));
      }
    });
  });

  describe('exportToCSV', () => {
    test('should create CSV stream with headers', (t, done) => {
      const data = [
        { id: '1', name: 'Test', value: 100 },
        { id: '2', name: 'Test2', value: 200 },
      ];
      const dataStream = Readable.from(data);
      const columns = ['id', 'name', 'value'];
      
      const csvStream = exportToCSV(dataStream, columns);
      
      let chunks = '';
      csvStream.on('data', (chunk) => {
        chunks += chunk.toString();
      });
      
      csvStream.on('end', () => {
        assert.ok(chunks.includes('id,name,value'));
        assert.ok(chunks.includes('1,Test,100'));
        assert.ok(chunks.includes('2,Test2,200'));
        done();
      });
    });

    test('should filter to specified columns', (t, done) => {
      const data = [
        { id: '1', name: 'Test', value: 100, extra: 'ignored' },
        { id: '2', name: 'Test2', value: 200, extra: 'ignored2' },
      ];
      const dataStream = Readable.from(data);
      const columns = ['id', 'value'];
      
      const csvStream = exportToCSV(dataStream, columns);
      
      let chunks = '';
      csvStream.on('data', (chunk) => {
        chunks += chunk.toString();
      });
      
      csvStream.on('end', () => {
        assert.ok(chunks.includes('id,value'));
        assert.ok(!chunks.includes('extra'));
        done();
      });
    });

    test('should handle empty data', (t, done) => {
      const data = [];
      const dataStream = Readable.from(data);
      const columns = ['id', 'name'];
      
      const csvStream = exportToCSV(dataStream, columns);
      
      let chunks = '';
      csvStream.on('data', (chunk) => {
        chunks += chunk.toString();
      });
      
      csvStream.on('end', () => {
        assert.ok(chunks.includes('id,name'));
        done();
      });
    });

    test('should handle stream errors', (t, done) => {
      const dataStream = new Readable({
        read() {
          this.emit('error', new Error('Stream error'));
        },
      });
      const columns = ['id', 'name'];
      
      const csvStream = exportToCSV(dataStream, columns);
      
      csvStream.on('error', (error) => {
        assert.strictEqual(error.message, 'Stream error');
        done();
      });
    });
  });

  describe('exportToJSON', () => {
    test('should create JSON array stream', (t, done) => {
      const data = [
        { id: '1', name: 'Test', value: 100 },
        { id: '2', name: 'Test2', value: 200 },
      ];
      const dataStream = Readable.from(data);
      const columns = ['id', 'name', 'value'];
      
      const jsonStream = exportToJSON(dataStream, columns, { pretty: false });
      
      let chunks = '';
      jsonStream.on('data', (chunk) => {
        chunks += chunk.toString();
      });
      
      jsonStream.on('end', () => {
        const parsed = JSON.parse(chunks);
        assert.strictEqual(parsed.length, 2);
        assert.strictEqual(parsed[0].id, '1');
        assert.strictEqual(parsed[1].id, '2');
        done();
      });
    });

    test('should create pretty-printed JSON', (t, done) => {
      const data = [{ id: '1', name: 'Test' }];
      const dataStream = Readable.from(data);
      const columns = ['id', 'name'];
      
      const jsonStream = exportToJSON(dataStream, columns, { pretty: true });
      
      let chunks = '';
      jsonStream.on('data', (chunk) => {
        chunks += chunk.toString();
      });
      
      jsonStream.on('end', () => {
        assert.ok(chunks.includes('\n'));
        assert.ok(chunks.includes('  '));
        done();
      });
    });

    test('should create NDJSON stream', (t, done) => {
      const data = [
        { id: '1', name: 'Test' },
        { id: '2', name: 'Test2' },
      ];
      const dataStream = Readable.from(data);
      const columns = ['id', 'name'];
      
      const jsonStream = exportToJSON(dataStream, columns, { ndjson: true });
      
      let chunks = '';
      jsonStream.on('data', (chunk) => {
        chunks += chunk.toString();
      });
      
      jsonStream.on('end', => {
        const lines = chunks.trim().split('\n');
        assert.strictEqual(lines.length, 2);
        assert.strictEqual(JSON.parse(lines[0]).id, '1');
        assert.strictEqual(JSON.parse(lines[1]).id, '2');
        done();
      });
    });

    test('should filter to specified columns', (t, done) => {
      const data = [
        { id: '1', name: 'Test', value: 100, extra: 'ignored' },
      ];
      const dataStream = Readable.from(data);
      const columns = ['id', 'name'];
      
      const jsonStream = exportToJSON(dataStream, columns);
      
      let chunks = '';
      jsonStream.on('data', (chunk) => {
        chunks += chunk.toString();
      });
      
      jsonStream.on('end', () => {
        const parsed = JSON.parse(chunks);
        assert.strictEqual(parsed[0].id, '1');
        assert.strictEqual(parsed[0].name, 'Test');
        assert.strictEqual(parsed[0].value, undefined);
        assert.strictEqual(parsed[0].extra, undefined);
        done();
      });
    });

    test('should handle empty data', (t, done) => {
      const data = [];
      const dataStream = Readable.from(data);
      const columns = ['id', 'name'];
      
      const jsonStream = exportToJSON(dataStream, columns);
      
      let chunks = '';
      jsonStream.on('data', (chunk) => {
        chunks += chunk.toString();
      });
      
      jsonStream.on('end', () => {
        const parsed = JSON.parse(chunks);
        assert.deepStrictEqual(parsed, []);
        done();
      });
    });
  });

  describe('setExportHeaders', () => {
    test('should set CSV headers', () => {
      const res = {
        setHeader: function(name, value) {
          this.headers[name] = value;
        },
        headers: {},
      };
      
      setExportHeaders(res, 'csv', 'test.csv');
      
      assert.strictEqual(res.headers['Content-Type'], 'text/csv; charset=utf-8');
      assert.strictEqual(res.headers['Content-Disposition'], 'attachment; filename="test.csv"');
      assert.strictEqual(res.headers['Transfer-Encoding'], 'chunked');
    });

    test('should set JSON headers', () => {
      const res = {
        setHeader: function(name, value) {
          this.headers[name] = value;
        },
        headers: {},
      };
      
      setExportHeaders(res, 'json', 'test.json');
      
      assert.strictEqual(res.headers['Content-Type'], 'application/json; charset=utf-8');
      assert.strictEqual(res.headers['Content-Disposition'], 'attachment; filename="test.json"');
    });

    test('should set NDJSON headers', () => {
      const res = {
        setHeader: function(name, value) {
          this.headers[name] = value;
        },
        headers: {},
      };
      
      setExportHeaders(res, 'ndjson', 'test.json');
      
      assert.strictEqual(res.headers['Content-Type'], 'application/x-ndjson; charset=utf-8');
    });
  });

  describe('SUPPORTED_FORMATS', () => {
    test('should contain expected formats', () => {
      assert.ok(Array.isArray(SUPPORTED_FORMATS));
      assert.ok(SUPPORTED_FORMATS.includes('csv'));
      assert.ok(SUPPORTED_FORMATS.includes('json'));
      assert.ok(SUPPORTED_FORMATS.includes('ndjson'));
    });
  });
});

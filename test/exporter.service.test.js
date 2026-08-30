const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  generateFilename,
  validateFormat,
  validateFields,
  SUPPORTED_FORMATS,
} = require('../src/services/exporter');

describe('Exporter Service', () => {
  describe('generateFilename', () => {
    test('should generate filename with date range', () => {
      const filename = generateFilename('readings', '2026-01-01', '2026-01-31', 'csv');
      assert.strictEqual(filename, 'readings-2026-01-01-to-2026-01-31.csv');
    });

    test('should generate filename without dates', () => {
      const filename = generateFilename('readings', null, null, 'json');
      assert.strictEqual(filename, 'readings.json');
    });

    test('should use json extension for ndjson', () => {
      const filename = generateFilename('data', '2026-01-01', '2026-01-31', 'ndjson');
      assert.strictEqual(filename, 'data-2026-01-01-to-2026-01-31.json');
    });
  });

  describe('validateFormat', () => {
    test('should accept valid formats', () => {
      assert.strictEqual(validateFormat('csv'), 'csv');
      assert.strictEqual(validateFormat('json'), 'json');
      assert.strictEqual(validateFormat('ndjson'), 'ndjson');
      assert.strictEqual(validateFormat('CSV'), 'csv');
    });

    test('should throw on invalid format', () => {
      assert.throws(() => {
        validateFormat('xml');
      }, /Invalid format/);
    });
  });

  describe('validateFields', () => {
    test('should return available fields when no fields requested', () => {
      const available = ['id', 'name', 'value'];
      const result = validateFields(null, available);
      assert.deepStrictEqual(result, available);
    });

    test('should return requested fields when valid', () => {
      const available = ['id', 'name', 'value'];
      const result = validateFields(['id', 'name'], available);
      assert.deepStrictEqual(result, ['id', 'name']);
    });

    test('should throw on invalid fields', () => {
      const available = ['id', 'name', 'value'];
      assert.throws(() => {
        validateFields(['id', 'invalid'], available);
      }, /Invalid fields requested/);
    });
  });

  describe('SUPPORTED_FORMATS', () => {
    test('should include csv, json, ndjson', () => {
      assert.ok(SUPPORTED_FORMATS.includes('csv'));
      assert.ok(SUPPORTED_FORMATS.includes('json'));
      assert.ok(SUPPORTED_FORMATS.includes('ndjson'));
    });
  });
});

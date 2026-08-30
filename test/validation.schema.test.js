const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  authChallengeSchema,
  dailySummaryQuerySchema,
  customRangeQuerySchema,
  fleetSummaryQuerySchema,
  exportReadingsQuerySchema,
  exportAnalyticsParamsSchema,
  adminCreateUserSchema,
  adminUpdateUserRolesSchema,
  adminConfigUpdateSchema,
  adminRegisterDeviceSchema,
  adminUpdateDeviceSchema,
} = require('../src/schemas/validation.schema');

describe('Validation Schemas', () => {
  describe('authChallengeSchema', () => {
    test('should accept valid wallet', () => {
      const result = authChallengeSchema.body.safeParse({ wallet: 'GABC123' });
      assert.strictEqual(result.success, true);
    });

    test('should accept empty body', () => {
      const result = authChallengeSchema.body.safeParse({});
      assert.strictEqual(result.success, true);
    });

    test('should reject empty wallet string', () => {
      const result = authChallengeSchema.body.safeParse({ wallet: '' });
      assert.strictEqual(result.success, false);
    });
  });

  describe('dailySummaryQuerySchema', () => {
    test('should accept valid query', () => {
      const result = dailySummaryQuerySchema.query.safeParse({
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });
      assert.strictEqual(result.success, true);
    });

    test('should require startDate and endDate', () => {
      const result = dailySummaryQuerySchema.query.safeParse({});
      assert.strictEqual(result.success, false);
    });

    test('should accept meterIds as string', () => {
      const result = dailySummaryQuerySchema.query.safeParse({
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        meterIds: 'METER-001',
      });
      assert.strictEqual(result.success, true);
    });
  });

  describe('exportAnalyticsParamsSchema', () => {
    test('should accept valid summaryType', () => {
      const result = exportAnalyticsParamsSchema.params.safeParse({ summaryType: 'daily' });
      assert.strictEqual(result.success, true);
    });

    test('should reject invalid summaryType', () => {
      const result = exportAnalyticsParamsSchema.params.safeParse({ summaryType: 'hourly' });
      assert.strictEqual(result.success, false);
    });
  });

  describe('adminCreateUserSchema', () => {
    test('should accept valid user data', () => {
      const result = adminCreateUserSchema.body.safeParse({
        email: 'test@example.com',
        name: 'Test User',
      });
      assert.strictEqual(result.success, true);
    });

    test('should require email and name', () => {
      const result = adminCreateUserSchema.body.safeParse({});
      assert.strictEqual(result.success, false);
    });

    test('should reject invalid email', () => {
      const result = adminCreateUserSchema.body.safeParse({
        email: 'not-an-email',
        name: 'Test',
      });
      assert.strictEqual(result.success, false);
    });

    test('should default roles to ["user"]', () => {
      const result = adminCreateUserSchema.body.safeParse({
        email: 'test@example.com',
        name: 'Test',
      });
      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.data.roles, ['user']);
    });
  });

  describe('adminRegisterDeviceSchema', () => {
    test('should accept valid device data', () => {
      const result = adminRegisterDeviceSchema.body.safeParse({
        deviceId: 'DEV-001',
        name: 'Test Device',
      });
      assert.strictEqual(result.success, true);
    });

    test('should require deviceId and name', () => {
      const result = adminRegisterDeviceSchema.body.safeParse({});
      assert.strictEqual(result.success, false);
    });
  });

  describe('adminConfigUpdateSchema', () => {
    test('should accept valid config update', () => {
      const result = adminConfigUpdateSchema.body.safeParse({
        values: { 'app.name': 'New Name' },
      });
      assert.strictEqual(result.success, true);
    });

    test('should reject empty values', () => {
      const result = adminConfigUpdateSchema.body.safeParse({
        values: {},
      });
      assert.strictEqual(result.success, false);
    });
  });
});

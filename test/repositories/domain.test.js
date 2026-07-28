const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

const {
  userRepository,
  deviceRepository,
  meterReadingRepository,
  webhookRepository,
  apiKeyRepository,
  configRepository,
} = require('../../src/repositories');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = 'admin@equipchain.io';
const DEV_KEY = 'ek_dev_equipchain_default_key';

// ---------------------------------------------------------------------------
// UserRepository
// ---------------------------------------------------------------------------

describe('UserRepository', () => {
  // Reseed the default admin after clearing so seed-data tests work
  before(async () => {
    await userRepository.clear();
    await userRepository.create({
      email: ADMIN_EMAIL,
      name: 'EquipChain Admin',
      role: 'admin',
      status: 'active',
      publicKey: 'GADMIN1234567890123456789012345678901234567890123',
    });
  });
  after(() => userRepository.clear());

  it('has a default admin user', async () => {
    const count = await userRepository.count();
    assert.strictEqual(count, 1);
  });

  it('finds user by email', async () => {
    const user = await userRepository.findByEmail(ADMIN_EMAIL);
    assert.ok(user);
    assert.strictEqual(user.role, 'admin');
  });

  it('finds user by public key', async () => {
    const admin = await userRepository.findByEmail(ADMIN_EMAIL);
    const found = await userRepository.findByPublicKey(admin.publicKey);
    assert.ok(found);
    assert.strictEqual(found.email, ADMIN_EMAIL);
  });

  it('returns null for non-existent email', async () => {
    const user = await userRepository.findByEmail('nobody@example.com');
    assert.strictEqual(user, null);
  });

  it('supports CRUD operations', async () => {
    const created = await userRepository.create({
      email: 'operator@equipchain.io',
      name: 'Operator',
      role: 'operator',
      status: 'active',
    });
    assert.ok(created.id);

    const found = await userRepository.findById(created.id);
    assert.strictEqual(found.email, 'operator@equipchain.io');

    const updated = await userRepository.update(created.id, { role: 'admin' });
    assert.strictEqual(updated.role, 'admin');

    const deleted = await userRepository.delete(created.id);
    assert.strictEqual(deleted, true);
  });
});

// ---------------------------------------------------------------------------
// DeviceRepository
// ---------------------------------------------------------------------------

describe('DeviceRepository', () => {
  before(async () => {
    await deviceRepository.clear();
    // Reseed default devices
    await deviceRepository.create({
      meterId: 'METER-001', name: 'Main Building', type: 'electricity',
      location: 'Building A, Floor 1', status: 'online', config: { baseLoad: 150 },
    });
    await deviceRepository.create({
      meterId: 'METER-002', name: 'Warehouse', type: 'electricity',
      location: 'Warehouse Zone B', status: 'online', config: { baseLoad: 80 },
    });
    await deviceRepository.create({
      meterId: 'METER-003', name: 'Office Wing', type: 'electricity',
      location: 'Building A, Floor 2-4', status: 'offline', config: { baseLoad: 100 },
    });
  });
  after(() => deviceRepository.clear());

  it('has 3 default devices', async () => {
    const count = await deviceRepository.count();
    assert.strictEqual(count, 3);
  });

  it('finds device by meterId', async () => {
    const device = await deviceRepository.findByMeterId('METER-001');
    assert.ok(device);
    assert.strictEqual(device.name, 'Main Building');
  });

  it('finds devices by status', async () => {
    const online = await deviceRepository.findOnline();
    assert.ok(online.length >= 2);
    const offline = await deviceRepository.findOffline();
    assert.ok(offline.length >= 1);
  });

  it('returns null for non-existent meterId', async () => {
    const device = await deviceRepository.findByMeterId('NONEXISTENT');
    assert.strictEqual(device, null);
  });
});

// ---------------------------------------------------------------------------
// MeterReadingRepository
// ---------------------------------------------------------------------------

describe('MeterReadingRepository', () => {
  before(() => meterReadingRepository.clear());
  after(() => meterReadingRepository.clear());

  it('stores and retrieves readings', async () => {
    const reading = await meterReadingRepository.addReadings({
      meterId: 'METER-001',
      timestamp: new Date('2026-01-15T12:00:00Z').getTime(),
      value: 150.5,
    });
    assert.ok(reading.id);
    assert.strictEqual(reading.meterId, 'METER-001');
  });

  it('batch inserts multiple readings', async () => {
    await meterReadingRepository.clear();
    const readings = await meterReadingRepository.addReadings([
      { meterId: 'METER-001', timestamp: new Date('2026-01-01T12:00:00Z').getTime(), value: 100 },
      { meterId: 'METER-001', timestamp: new Date('2026-01-02T12:00:00Z').getTime(), value: 200 },
      { meterId: 'METER-002', timestamp: new Date('2026-01-01T12:00:00Z').getTime(), value: 50 },
    ]);
    assert.strictEqual(readings.length, 3);
    assert.strictEqual(await meterReadingRepository.readingCount(), 3);
  });

  it('finds readings by meter ID and date range', async () => {
    const readings = await meterReadingRepository.findByMeterId('METER-001', {
      startDate: '2026-01-01',
      endDate: '2026-01-02',
    });
    assert.strictEqual(readings.length, 2);
  });

  it('finds readings by date range', async () => {
    const readings = await meterReadingRepository.findByDateRange('2026-01-01', '2026-01-01');
    assert.strictEqual(readings.length, 2);
  });

  it('filters readings with getReadings', async () => {
    const all = await meterReadingRepository.getReadings();
    assert.strictEqual(all.length, 3);

    const filtered = await meterReadingRepository.getReadings({ meterIds: ['METER-001'] });
    assert.strictEqual(filtered.length, 2);
  });

  it('clears readings', async () => {
    await meterReadingRepository.clearReadings();
    assert.strictEqual(await meterReadingRepository.readingCount(), 0);
  });
});

// ---------------------------------------------------------------------------
// WebhookRepository
// ---------------------------------------------------------------------------

describe('WebhookRepository', () => {
  before(() => webhookRepository.clear());
  after(() => webhookRepository.clear());

  it('creates and finds webhooks by event', async () => {
    const webhook = await webhookRepository.create({
      url: 'https://hooks.example.com/meter-updates',
      event: 'meter:reading',
      status: 'active',
      description: 'Meter reading updates',
    });
    assert.ok(webhook.id);

    const found = await webhookRepository.findByEvent('meter:reading');
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].url, 'https://hooks.example.com/meter-updates');
  });

  it('finds webhooks by URL', async () => {
    const found = await webhookRepository.findByUrl('https://hooks.example.com/meter-updates');
    assert.ok(found);
    assert.strictEqual(found.event, 'meter:reading');
  });

  it('logs delivery attempts', async () => {
    const webhooks = await webhookRepository.findByEvent('meter:reading');
    const webhook = webhooks[0];

    await webhookRepository.logDelivery(webhook.id, 200, { ok: true });
    await webhookRepository.logDelivery(webhook.id, 500, null);

    const logs = await webhookRepository.getDeliveryLogs(webhook.id);
    assert.strictEqual(logs.length, 2);
    assert.strictEqual(logs[0].statusCode, 200);
    assert.strictEqual(logs[1].statusCode, 500);
  });
});

// ---------------------------------------------------------------------------
// ApiKeyRepository
// ---------------------------------------------------------------------------

describe('ApiKeyRepository', () => {
  before(async () => {
    await apiKeyRepository.clear();
    // Reseed default dev key
    await apiKeyRepository.create({
      key: DEV_KEY,
      name: 'Development Key',
      userId: '1',
      status: 'active',
      permissions: ['read', 'write'],
    });
  });
  after(() => apiKeyRepository.clear());

  it('has a default dev key', async () => {
    const count = await apiKeyRepository.count();
    assert.strictEqual(count, 1);
  });

  it('finds API key by key value', async () => {
    const key = await apiKeyRepository.findByKey(DEV_KEY);
    assert.ok(key);
    assert.strictEqual(key.name, 'Development Key');
  });

  it('creates keys with auto-generated key values', async () => {
    const created = await apiKeyRepository.create({
      name: 'Test Key',
      userId: '1',
      permissions: ['read'],
    });
    assert.ok(created.key);
    assert.ok(created.key.startsWith('ek_'));
  });

  it('revokes keys', async () => {
    const created = await apiKeyRepository.create({
      name: 'Revocable Key',
      userId: '1',
      permissions: ['read'],
    });
    const revoked = await apiKeyRepository.revokeKey(created.key);
    assert.strictEqual(revoked.status, 'revoked');
  });

  it('finds active keys', async () => {
    const active = await apiKeyRepository.findActive();
    assert.ok(active.length > 0);
    active.forEach((k) => assert.strictEqual(k.status, 'active'));
  });
});

// ---------------------------------------------------------------------------
// ConfigRepository
// ---------------------------------------------------------------------------

describe('ConfigRepository', () => {
  before(async () => {
    await configRepository.clear();
    await configRepository.set('app.name', 'EquipChain API');
    await configRepository.set('app.version', '1.0.0');
    await configRepository.set('rateLimit.max', '100');
    await configRepository.set('rateLimit.window', '900000');
    await configRepository.set('auth.tokenExpiry', '3600');
    await configRepository.set('auth.maxLoginAttempts', '5');
  });
  after(() => configRepository.clear());

  it('has seeded config values', async () => {
    const count = await configRepository.count();
    assert.ok(count >= 5);
  });

  it('gets a config value by key', async () => {
    const value = await configRepository.get('app.name');
    assert.strictEqual(value, 'EquipChain API');
  });

  it('sets a new config value', async () => {
    await configRepository.set('app.custom', 'custom value');
    const value = await configRepository.get('app.custom');
    assert.strictEqual(value, 'custom value');
  });

  it('updates an existing config value', async () => {
    await configRepository.set('app.name', 'EquipChain API v2');
    const value = await configRepository.get('app.name');
    assert.strictEqual(value, 'EquipChain API v2');
  });

  it('gets config by group', async () => {
    const group = await configRepository.getByGroup('auth');
    assert.ok(group.length > 0);
    group.forEach((item) => assert.ok(item.key.startsWith('auth.')));
  });

  it('returns all config as a flat map', async () => {
    const all = await configRepository.getAll();
    assert.ok(all['app.name']);
    assert.ok(typeof all['rateLimit.max'] === 'string');
  });
});

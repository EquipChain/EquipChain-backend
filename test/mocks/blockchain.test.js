const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { MockSorobanClient } = require('./mocks/blockchain');

describe('Mock Soroban Client', () => {
  let client;

  beforeEach(() => {
    client = new MockSorobanClient();
  });

  test('should initialize mock state', async () => {
    await client.init();
    const state = await client.getContractState(
      'CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS'
    );
    assert.ok(state);
    assert.ok(state.meters);
    assert.strictEqual(state.meters.length, 3);
  });

  test('should get contract state', async () => {
    await client.init();
    const state = await client.getContractState(
      'CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS'
    );
    assert.strictEqual(state.name, 'EquipChain');
    assert.ok(state.totalReadings >= 0);
  });

  test('should throw for non-existent contract', async () => {
    await client.init();
    assert.rejects(
      () => client.getContractState('NON-EXISTENT'),
      /Contract NON-EXISTENT not found/
    );
  });

  test('should get meter readings', async () => {
    await client.init();
    const readings = await client.getMeterReadings(
      'CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS',
      'METER-001'
    );
    assert.ok(Array.isArray(readings));
    assert.ok(readings.length > 0);
    assert.strictEqual(readings[0].meterId, 'METER-001');
  });

  test('should respect limit option', async () => {
    await client.init();
    const readings = await client.getMeterReadings(
      'CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS',
      'METER-001',
      { limit: 5 }
    );
    assert.ok(readings.length <= 5);
  });

  test('should submit a transaction', async () => {
    await client.init();
    const tx = await client.submitTransaction({
      type: 'register_reading',
      data: { meterId: 'METER-001', value: 100 },
    });
    assert.ok(tx.id);
    assert.strictEqual(tx.status, 'submitted');
  });

  test('should get transaction status', async () => {
    await client.init();
    const tx = await client.submitTransaction({ type: 'test' });
    const status = await client.getTransactionStatus(tx.id);
    assert.strictEqual(status.id, tx.id);
    assert.strictEqual(status.type, 'test');
  });

  test('should return not_found for unknown transaction', async () => {
    await client.init();
    const status = await client.getTransactionStatus('non-existent');
    assert.strictEqual(status.status, 'not_found');
  });

  test('should get block height', async () => {
    const height = await client.getBlockHeight();
    assert.ok(typeof height === 'number');
    assert.ok(height > 0);
  });

  test('should advance blocks', async () => {
    const initial = await client.getBlockHeight();
    client.advanceBlocks(100);
    const after = await client.getBlockHeight();
    assert.strictEqual(after, initial + 100);
  });

  test('should reset state', async () => {
    await client.init();
    client.advanceBlocks(500);
    await client.submitTransaction({ type: 'test' });

    client.reset();

    const height = await client.getBlockHeight();
    assert.strictEqual(height, 1000000);
  });
});

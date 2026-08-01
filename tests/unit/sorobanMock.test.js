const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { SorobanMock } = require('../mocks/sorobanMock');

describe('Soroban Mock Layer', () => {
  let mock;

  beforeEach(() => {
    mock = new SorobanMock();
  });

  test('returns default success for getContractData', async () => {
    const result = await mock.getContractData('contract-1', 'key-1');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data, null);
  });

  test('logs all calls', async () => {
    await mock.getContractData('c1', 'k1');
    await mock.simulateTransaction({ tx: 'test' });
    await mock.sendTransaction({ tx: 'test' });
    await mock.getTransactionStatus('hash123');
    const log = mock.getCallLog();
    assert.strictEqual(log.length, 4);
    assert.strictEqual(log[0].method, 'getContractData');
    assert.strictEqual(log[1].method, 'simulateTransaction');
    assert.strictEqual(log[2].method, 'sendTransaction');
    assert.strictEqual(log[3].method, 'getTransactionStatus');
  });

  test('supports error mode for getContractData', async () => {
    mock.setErrorMode('getContractData');
    const result = await mock.getContractData('c1', 'k1');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'CONTRACT_NOT_FOUND');
  });

  test('supports error mode for simulateTransaction', async () => {
    mock.setErrorMode('simulateTransaction');
    const result = await mock.simulateTransaction({ tx: 'test' });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'SIMULATION_FAILED');
  });

  test('supports custom responses', async () => {
    mock.setResponse('getContractData', { success: true, data: { balance: 1000 } });
    const result = await mock.getContractData('c1', 'k1');
    assert.strictEqual(result.data.balance, 1000);
  });

  test('resets to defaults', async () => {
    mock.setErrorMode('getContractData');
    mock.setResponse('getContractData', { success: true, data: 'custom' });
    mock.reset();
    const result = await mock.getContractData('c1', 'k1');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data, null);
  });
});

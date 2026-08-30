// test/mocks/blockchain.js
//
// Mock Soroban/blockchain layer for testing. Simulates on-chain data
// without requiring a real blockchain connection.

/**
 * Mock Soroban client that simulates blockchain interactions
 */
class MockSorobanClient {
  constructor() {
    this._contracts = new Map();
    this._accounts = new Map();
    this._transactions = [];
    this._blockHeight = 1000000;
    this._initialized = false;
  }

  /**
   * Initialize mock blockchain state
   */
  async init() {
    if (this._initialized) return;

    // Mock contract state
    this._contracts.set('CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS', {
      id: 'CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS',
      name: 'EquipChain',
      meters: [
        { meterId: 'METER-001', owner: 'GADMIN1234567890123456789012345678901234567890123', status: 'active' },
        { meterId: 'METER-002', owner: 'GADMIN1234567890123456789012345678901234567890123', status: 'active' },
        { meterId: 'METER-003', owner: 'GADMIN1234567890123456789012345678901234567890123', status: 'inactive' },
      ],
      totalReadings: 0,
      lastSyncBlock: this._blockHeight,
    });

    // Mock accounts
    this._accounts.set('GADMIN1234567890123456789012345678901234567890123', {
      publicKey: 'GADMIN1234567890123456789012345678901234567890123',
      balance: 1000000,
      sequence: 1,
    });

    this._initialized = true;
  }

  /**
   * Get contract state
   */
  async getContractState(contractId) {
    await this._ensureInitialized();
    const contract = this._contracts.get(contractId);
    if (!contract) {
      throw new Error(`Contract ${contractId} not found`);
    }
    return { ...contract };
  }

  /**
   * Get meter readings from chain
   */
  async getMeterReadings(contractId, meterId, options = {}) {
    await this._ensureInitialized();
    const { fromBlock, toBlock, limit = 100 } = options;
    const startBlock = fromBlock || this._blockHeight - 1000;
    const endBlock = toBlock || this._blockHeight;

    // Generate mock readings
    const readings = [];
    const now = Date.now();
    for (let i = 0; i < Math.min(limit, 50); i++) {
      readings.push({
        id: `tx-${Date.now()}-${i}`,
        meterId,
        timestamp: now - i * 3600000,
        value: 100 + Math.random() * 50,
        unit: 'kWh',
        blockHeight: endBlock - i,
        status: 'confirmed',
      });
    }

    return readings;
  }

  /**
   * Submit a transaction to the chain
   */
  async submitTransaction(txData) {
    await this._ensureInitialized();
    const tx = {
      id: `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ...txData,
      blockHeight: this._blockHeight + 1,
      status: 'submitted',
      submittedAt: new Date().toISOString(),
    };
    this._transactions.push(tx);
    return tx;
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(txId) {
    await this._ensureInitialized();
    const tx = this._transactions.find((t) => t.id === txId);
    if (!tx) {
      return { status: 'not_found' };
    }
    return { ...tx };
  }

  /**
   * Get current block height
   */
  async getBlockHeight() {
    return this._blockHeight;
  }

  /**
   * Simulate time passing (for testing)
   */
  advanceBlocks(count) {
    this._blockHeight += count;
  }

  /**
   * Reset mock state
   */
  reset() {
    this._contracts.clear();
    this._accounts.clear();
    this._transactions = [];
    this._blockHeight = 1000000;
    this._initialized = false;
  }

  async _ensureInitialized() {
    if (!this._initialized) {
      await this.init();
    }
  }
}

// Singleton mock client
const mockSorobanClient = new MockSorobanClient();

module.exports = { MockSorobanClient, mockSorobanClient };

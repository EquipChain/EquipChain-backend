/**
 * Mock Soroban RPC layer for testing contract interactions
 * without requiring a live network connection.
 * 
 * Configurable responses for getContractData, simulateTransaction,
 * sendTransaction, and getTransactionStatus.
 */

class SorobanMock {
  constructor() {
    this.responses = {
      getContractData: { success: true, data: null },
      simulateTransaction: { success: true, results: [] },
      sendTransaction: { success: true, hash: '0x' + 'a'.repeat(64) },
      getTransactionStatus: { status: 'SUCCESS' }
    };
    this.callLog = [];
    this.errorMode = null;
  }

  setErrorMode(mode) { this.errorMode = mode; }
  setResponse(method, response) { this.responses[method] = response; }

  reset() {
    this.responses = {
      getContractData: { success: true, data: null },
      simulateTransaction: { success: true, results: [] },
      sendTransaction: { success: true, hash: '0x' + 'a'.repeat(64) },
      getTransactionStatus: { status: 'SUCCESS' }
    };
    this.callLog = [];
    this.errorMode = null;
  }

  async getContractData(contractId, key) {
    this.callLog.push({ method: 'getContractData', contractId, key });
    if (this.errorMode === 'getContractData') return { success: false, error: 'CONTRACT_NOT_FOUND' };
    return this.responses.getContractData;
  }

  async simulateTransaction(tx) {
    this.callLog.push({ method: 'simulateTransaction', tx });
    if (this.errorMode === 'simulateTransaction') return { success: false, error: 'SIMULATION_FAILED' };
    return this.responses.simulateTransaction;
  }

  async sendTransaction(tx) {
    this.callLog.push({ method: 'sendTransaction', tx });
    if (this.errorMode === 'sendTransaction') return { success: false, error: 'TX_REJECTED' };
    return this.responses.sendTransaction;
  }

  async getTransactionStatus(hash) {
    this.callLog.push({ method: 'getTransactionStatus', hash });
    if (this.errorMode === 'getTransactionStatus') return { status: 'FAILED', error: 'TIMEOUT' };
    return this.responses.getTransactionStatus;
  }

  getCallLog() { return this.callLog; }
}

module.exports = { SorobanMock };

'use strict';

// src/lib/soroban.js
//
// Soroban RPC data source. Selects a backend at construction:
//  - SOROBAN_RPC_URL set  -> real JSON-RPC client over HTTP (fetch)
//  - not set (or mock=1)  -> in-process mock (the same model the test suite
//    uses), so dev/test environments work with zero chain infrastructure.
//
// Real deployments point SOROBAN_RPC_URL at a Soroban RPC endpoint (e.g.
// https://soroban-testnet.stellar.org). Only the contract read calls the
// sync job needs are implemented - each maps to a Soroban RPC method.

const { childLogger } = require('../config/logger');

const log = childLogger('soroban');

class SorobanDataSource {
  constructor(options = {}) {
    this.rpcUrl = options.rpcUrl || process.env.SOROBAN_RPC_URL || '';
    this.contractId = options.contractId || process.env.CONTRACT_ID || '';
    this.useMock =
      options.useMock !== undefined
        ? options.useMock
        : !this.rpcUrl || process.env.SOROBAN_USE_MOCK === '1';
    if (this.useMock) {
      this.mock = options.mock || require('../../test/mocks/blockchain').mockSorobanClient;
      log.warn('Soroban data source in MOCK mode: on-chain reads are simulated');
    }
  }

  /**
   * Raw JSON-RPC call with bounded latency. Timeout uses AbortSignal so a
   * hung RPC node fails the request (and the calling job) instead of pinning
   * a queue slot.
   */
  async rpc(method, params = []) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    timer.unref?.();
    try {
      const res = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Soroban RPC ${method} failed with HTTP ${res.status}`);
      }
      const body = await res.json();
      if (body.error) {
        throw new Error(`Soroban RPC ${method} error: ${body.error.message}`);
      }
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Current ledger sequence.
   */
  async getBlockHeight() {
    if (this.useMock) {
      await this.mock.init();
      return this.mock.getBlockHeight();
    }
    const result = await this.rpc('getLatestLedger');
    return result.sequence;
  }

  /**
   * Contract's stored meter registry entry: returns the raw ledger value.
   * Uses expandTemporary/ContractData ledger entry for the meters key.
   */
  async getContractState() {
    if (this.useMock) {
      await this.mock.init();
      return this.mock.getContractState(this.contractId);
    }
    const key = Buffer.from(JSON.stringify({ contract: this.contractId, name: 'meters' })).toString('base64');
    const result = await this.rpc('getLedgerEntries', [[key]]);
    const entry = result.entries && result.entries[0];
    if (!entry) {
      throw new Error(`No meter registry found for contract ${this.contractId}`);
    }
    return JSON.parse(Buffer.from(entry.keyXdr, 'base64').toString());
  }
}

module.exports = { SorobanDataSource };

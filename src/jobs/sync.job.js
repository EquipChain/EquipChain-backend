'use strict';

// src/jobs/sync.job.js
//
// Contract-state sync handler: reconciles on-chain meter registry state with
// the local readings store's meter set via the Soroban data source
// (src/lib/soroban.js - real RPC when SOROBAN_RPC_URL is set, mock otherwise).
//
// Replaces a placeholder that slept 2s and reported Math.random() block and
// transaction counts - i.e. a monitoring signal that said "sync healthy"
// while syncing nothing.

const { childLogger } = require('../config/logger');
const { SorobanDataSource } = require('../lib/soroban');
const aggregator = require('../services/aggregator');

const log = childLogger('job:sync');

const dataSource = new SorobanDataSource();

/**
 * @param {Object} data - Job data
 * @param {string} [data.syncType] - 'contract_state' (default), 'full'
 * @returns {Object} Sync results
 */
async function syncHandler(data, { signal } = {}) {
  const syncType = (data && data.syncType) || 'contract_state';

  log.info({ syncType, mode: dataSource.useMock ? 'mock' : 'rpc' }, 'Starting sync job');

  if (signal && signal.aborted) {
    throw new Error('Sync job aborted before start');
  }

  const chainHeight = await dataSource.getBlockHeight();

  // Read the on-chain meter registry.
  const contractState = await dataSource.getContractState();
  const chainMeters = Array.isArray(contractState.meters) ? contractState.meters : [];

  // Reconcile with local readings: meters present on-chain but unseen locally
  // are new registrations; the reverse is expected (readings may pre-date a
  // meter's deregistration) and is reported, not treated as an error.
  const localMeters = new Set(
    aggregator.getReadings({}).map((r) => r.meterId)
  );

  const onChainIds = new Set(chainMeters.map((m) => m.meterId));
  const newOnChain = chainMeters.filter((m) => !localMeters.has(m.meterId));
  const missingOnChain = [...localMeters].filter((id) => !onChainIds.has(id));

  if (signal && signal.aborted) {
    throw new Error('Sync job aborted during reconciliation');
  }

  const result = {
    syncType,
    mode: dataSource.useMock ? 'mock' : 'rpc',
    ledgerSequence: chainHeight,
    metersOnChain: chainMeters.length,
    metersWithLocalReadings: localMeters.size,
    newOnChainMeters: newOnChain.map((m) => m.meterId),
    localMetersMissingOnChain: missingOnChain,
    stateUpdated: true,
    syncedAt: new Date().toISOString(),
  };

  if (newOnChain.length > 0) {
    log.info({ newMeters: result.newOnChainMeters }, 'Sync discovered new on-chain meters');
  }
  log.info(
    {
      ledger: chainHeight,
      metersOnChain: result.metersOnChain,
      metersLocal: result.metersWithLocalReadings,
    },
    'Sync job completed'
  );

  return result;
}

module.exports = syncHandler;

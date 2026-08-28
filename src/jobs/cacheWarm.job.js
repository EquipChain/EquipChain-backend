const { childLogger } = require('../config/logger');
const { cacheService } = require('../services/cache');

const log = childLogger('job:cacheWarm');

/**
 * Cache warm job handler
 * Warms cache for frequently accessed data by pre-fetching blockchain/Soroban data
 *
 * @param {Object} data - Job data
 * @param {string} data.cacheType - Type of cache to warm ('meter_data', 'contract_state', 'fleet_summary')
 * @param {Array<string>} data.keys - Specific cache keys to warm (optional)
 * @returns {Object} Cache warming results
 */
async function cacheWarmHandler(data) {
  const { cacheType, keys } = data;

  log.info({ cacheType, keys }, 'Starting cache warm job');

  let keysWarmed = 0;
  const warmedKeys = [];

  switch (cacheType) {
    case 'meter_data': {
      // Warm recent meter readings cache
      const meterIds = ['METER-001', 'METER-002', 'METER-003'];
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      const key = `readings:${meterIds.join(',')}:${oneDayAgo}:${now}`;

      // Simulate fetching from Soroban/blockchain
      const readings = meterIds.map((meterId, idx) => ({
        meterId,
        timestamp: now - idx * 3600000,
        value: 100 + Math.random() * 50,
        unit: 'kWh',
      }));

      await cacheService.set(key, readings, 1800); // 30 min TTL
      warmedKeys.push(key);
      keysWarmed++;
      break;
    }

    case 'contract_state': {
      // Warm contract state cache
      const contractKey = 'contract:state:latest';
      const contractState = {
        totalMeters: 3,
        activeMeters: 2,
        lastSync: new Date().toISOString(),
        blockHeight: Math.floor(Math.random() * 100000),
      };

      await cacheService.set(contractKey, contractState, 300); // 5 min TTL
      warmedKeys.push(contractKey);
      keysWarmed++;
      break;
    }

    case 'fleet_summary': {
      // Warm fleet summary analytics cache
      const summaryKey = 'analytics:fleet:latest';
      const fleetSummary = {
        totalReadings: Math.floor(Math.random() * 10000),
        totalMeters: 3,
        averageConsumption: (100 + Math.random() * 50).toFixed(2),
        peakConsumption: (150 + Math.random() * 50).toFixed(2),
        lastUpdated: new Date().toISOString(),
      };

      await cacheService.set(summaryKey, fleetSummary, 600); // 10 min TTL
      warmedKeys.push(summaryKey);
      keysWarmed++;
      break;
    }

    default: {
      // Warm all known cache types
      log.warn({ cacheType }, 'Unknown cache type, warming all');
      await cacheWarmHandler({ cacheType: 'meter_data' });
      await cacheWarmHandler({ cacheType: 'contract_state' });
      await cacheWarmHandler({ cacheType: 'fleet_summary' });
      return { cacheType: 'all', keysWarmed: 3, warmedAt: new Date().toISOString() };
    }
  }

  // If specific keys were requested, warm those too
  if (keys && keys.length > 0) {
    for (const key of keys) {
      const data = { warmedAt: new Date().toISOString() };
      await cacheService.set(key, data, 1800);
      warmedKeys.push(key);
      keysWarmed++;
    }
  }

  const stats = await cacheService.getStats();
  const result = {
    cacheType,
    keysWarmed,
    warmedKeys,
    cacheStats: stats,
    warmedAt: new Date().toISOString(),
  };

  log.info({ result }, 'Cache warm job completed');

  return result;
}

module.exports = cacheWarmHandler;

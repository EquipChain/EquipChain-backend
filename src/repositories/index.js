/**
 * Repositories Index
 *
 * Central export point for all domain repositories.
 * Usage:
 *   const { userRepository, deviceRepository } = require('./repositories');
 */

const BaseRepository = require('./BaseRepository');
const UserRepository = require('./UserRepository');
const DeviceRepository = require('./DeviceRepository');
const MeterReadingRepository = require('./MeterReadingRepository');
const WebhookRepository = require('./WebhookRepository');
const ApiKeyRepository = require('./ApiKeyRepository');
const ConfigRepository = require('./ConfigRepository');

// Singleton instances
const userRepository = new UserRepository();
const deviceRepository = new DeviceRepository();
const meterReadingRepository = new MeterReadingRepository();
const webhookRepository = new WebhookRepository();
const apiKeyRepository = new ApiKeyRepository();
const configRepository = new ConfigRepository();

module.exports = {
  BaseRepository,
  UserRepository,
  DeviceRepository,
  MeterReadingRepository,
  WebhookRepository,
  ApiKeyRepository,
  ConfigRepository,
  // Singleton instances
  userRepository,
  deviceRepository,
  meterReadingRepository,
  webhookRepository,
  apiKeyRepository,
  configRepository,
};

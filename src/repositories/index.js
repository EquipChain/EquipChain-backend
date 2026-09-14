'use strict';

// src/repositories/index.js
//
// Barrel for the repository layer. Tests and route code require this path, so
// it must exist as CommonJS. The repository classes were originally written in
// TypeScript (BaseRepository.ts etc.) but the migration was never wired to a
// build step, which left `require('../repositories')` throwing and the domain
// test suite failing. The classes now live as CommonJS modules alongside the
// .ts sources they replace (kept only as historical reference until removed).

const { BaseRepository } = require('./BaseRepository');
const { UserRepository, userRepository } = require('./UserRepository');
const { DeviceRepository, deviceRepository } = require('./DeviceRepository');
const {
  MeterReadingRepository,
  meterReadingRepository,
} = require('./MeterReadingRepository');
const {
  WebhookRepository,
  webhookRepository,
} = require('./WebhookRepository');
const { ApiKeyRepository, apiKeyRepository } = require('./ApiKeyRepository');
const { ConfigRepository, configRepository } = require('./ConfigRepository');

module.exports = {
  BaseRepository,
  UserRepository,
  DeviceRepository,
  MeterReadingRepository,
  WebhookRepository,
  ApiKeyRepository,
  ConfigRepository,
  userRepository,
  deviceRepository,
  meterReadingRepository,
  webhookRepository,
  apiKeyRepository,
  configRepository,
};

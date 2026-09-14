'use strict';

// src/repositories/ApiKeyRepository.js
// CommonJS port of ApiKeyRepository.ts (part of restoring the broken
// repository layer after the unfinished TypeScript migration).

const crypto = require('crypto');
const BaseRepository = require('./BaseRepository');

class ApiKeyRepository extends BaseRepository {
  constructor() {
    super({ entityName: 'apiKey' });
    this._allowedFilters = ['status', 'userId'];
    this._sortableFields = ['name', 'status', 'createdAt', 'expiresAt'];
    this._searchableFields = ['name', 'key'];

    this._seedDefaults();
  }

  /**
   * Generate a cryptographically random API key.
   * @returns {string}
   */
  static generateKey() {
    return `ek_${crypto.randomBytes(32).toString('hex')}`;
  }

  _seedDefaults() {
    if (this._store.size === 0) {
      const now = new Date().toISOString();
      const devKey = {
        id: this._generateId(),
        key: 'ek_dev_equipchain_default_key',
        name: 'Development Key',
        userId: '1',
        status: 'active',
        permissions: ['read', 'write'],
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: now,
        updatedAt: now,
      };
      this._store.set(devKey.id, devKey);
    }
  }

  /**
   * @param {string} key
   * @returns {Promise<Object|null>}
   */
  async findByKey(key) {
    for (const apiKey of this._store.values()) {
      if (apiKey.key === key) {
        return { ...apiKey };
      }
    }
    return null;
  }

  /**
   * @param {string} userId
   * @returns {Promise<Object[]>}
   */
  async findByUserId(userId) {
    return [...this._store.values()]
      .filter((k) => k.userId === userId)
      .map((k) => ({ ...k }));
  }

  /**
   * Revoke a key by its secret value.
   * @param {string} key
   * @returns {Promise<Object|null>}
   */
  async revokeKey(key) {
    const apiKey = await this.findByKey(key);
    if (!apiKey) return null;
    return this.update(apiKey.id, { status: 'revoked' });
  }

  /**
   * Keys that are active and unexpired at the current instant.
   * @returns {Promise<Object[]>}
   */
  async findActive() {
    const now = new Date().toISOString();
    return [...this._store.values()]
      .filter((k) => k.status === 'active' && k.expiresAt > now)
      .map((k) => ({ ...k }));
  }

  /**
   * Create an API key, generating a secret and applying defaults.
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  async create(data) {
    const key = data.key || ApiKeyRepository.generateKey();
    return super.create({
      ...data,
      key,
      status: data.status || 'active',
      permissions: data.permissions || ['read'],
      expiresAt:
        data.expiresAt ||
        new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }
}

module.exports = ApiKeyRepository;
module.exports.ApiKeyRepository = ApiKeyRepository;
module.exports.apiKeyRepository = new ApiKeyRepository();

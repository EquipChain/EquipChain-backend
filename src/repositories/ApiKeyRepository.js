/**
 * ApiKeyRepository — API Key Store
 *
 * Manages API keys for programmatic access. Pre-seeds a default development key.
 *
 * Domain-specific methods:
 *   - findByKey(key)
 *   - findByUserId(userId)
 *   - revokeKey(key)
 *   - findActive()
 */

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
   * Generate a new API key.
   * @returns {string}
   */
  static generateKey() {
    return `ek_${crypto.randomBytes(32).toString('hex')}`;
  }

  /**
   * Pre-seed a default development API key.
   */
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
   * Find an API key by its key value.
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
   * Find all API keys belonging to a user.
   * @param {string} userId
   * @returns {Promise<Array>}
   */
  async findByUserId(userId) {
    return [...this._store.values()]
      .filter((k) => k.userId === userId)
      .map((k) => ({ ...k }));
  }

  /**
   * Revoke an API key by setting its status to 'revoked'.
   * @param {string} key
   * @returns {Promise<Object|null>}
   */
  async revokeKey(key) {
    const apiKey = await this.findByKey(key);
    if (!apiKey) return null;
    return this.update(apiKey.id, { status: 'revoked' });
  }

  /**
   * Find all active (non-revoked, non-expired) API keys.
   * @returns {Promise<Array>}
   */
  async findActive() {
    const now = new Date().toISOString();
    return [...this._store.values()]
      .filter((k) => k.status === 'active' && k.expiresAt > now)
      .map((k) => ({ ...k }));
  }

  /**
   * Create a new API key. Respects a passed `key` value; auto-generates one when absent.
   * @param {Object} data - { name, userId, permissions, key?, expiresAt? }
   * @returns {Promise<Object>}
   */
  async create(data) {
    const key = data.key || ApiKeyRepository.generateKey();
    return super.create({
      ...data,
      key,
      status: data.status || 'active',
      permissions: data.permissions || ['read'],
      expiresAt: data.expiresAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }
}

module.exports = ApiKeyRepository;

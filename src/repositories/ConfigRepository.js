/**
 * ConfigRepository — Protocol Configuration Store
 *
 * Manages system-wide configuration key-value pairs. Pre-seeds default values.
 *
 * Domain-specific methods:
 *   - get(key)
 *   - set(key, value)
 *   - getByGroup(group)
 *   - getAll()
 */

const BaseRepository = require('./BaseRepository');

const DEFAULT_CONFIG = {
  'app.name': 'EquipChain API',
  'app.version': '1.0.0',
  'app.description': 'Utility meter monitoring and data access platform',

  'meters.defaultInterval': '3600',
  'meters.maxReadingAge': '7776000', // 90 days in seconds
  'meters.dataRetentionDays': '365',

  'analytics.defaultAggregation': 'avg',
  'analytics.cacheTTL': '3600',

  'auth.tokenExpiry': '3600',
  'auth.maxLoginAttempts': '5',
  'auth.lockoutDuration': '900',

  'rateLimit.window': '900000', // 15 min in ms
  'rateLimit.max': '100',

  'webhook.maxRetries': '3',
  'webhook.retryDelay': '5000',
  'webhook.timeout': '10000',

  'monitoring.logLevel': 'info',
  'monitoring.otelEnabled': 'true',
};

class ConfigRepository extends BaseRepository {
  constructor() {
    super({ entityName: 'config' });
    this._allowedFilters = ['group'];
    this._sortableFields = ['key', 'group', 'updatedAt'];
    this._searchableFields = ['key', 'value', 'description'];

    this._seedDefaults();
  }

  /**
   * Pre-seed default configuration values.
   */
  _seedDefaults() {
    if (this._store.size === 0) {
      const now = new Date().toISOString();
      for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
        const group = key.split('.')[0];
        const entity = {
          id: this._generateId(),
          key,
          value,
          group,
          description: `Configuration for ${key}`,
          createdAt: now,
          updatedAt: now,
        };
        this._store.set(entity.id, entity);
      }
    }
  }

  /**
   * Get a configuration value by key.
   * @param {string} key
   * @returns {Promise<string|null>}
   */
  async get(key) {
    for (const config of this._store.values()) {
      if (config.key === key) {
        return config.value;
      }
    }
    return null;
  }

  /**
   * Set a configuration value by key (creates or updates).
   * @param {string} key
   * @param {string} value
   * @returns {Promise<Object>}
   */
  async set(key, value) {
    // Check if key exists
    for (const config of this._store.values()) {
      if (config.key === key) {
        return this.update(config.id, { value });
      }
    }

    // Create new config entry
    const group = key.split('.')[0];
    return this.create({ key, value, group });
  }

  /**
   * Get all configuration values for a group.
   * @param {string} group
   * @returns {Promise<Array>}
   */
  async getByGroup(group) {
    return [...this._store.values()]
      .filter((c) => c.group === group)
      .map((c) => ({ key: c.key, value: c.value }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * Get all configuration values as a flat key-value map.
   * @returns {Promise<Object>}
   */
  async getAll() {
    const result = {};
    for (const config of this._store.values()) {
      result[config.key] = config.value;
    }
    return result;
  }
}

module.exports = ConfigRepository;

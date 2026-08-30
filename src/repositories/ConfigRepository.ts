import { BaseRepository, BaseEntity } from './BaseRepository';

export interface ConfigEntity extends BaseEntity {
  key: string;
  value: string;
  group: string;
  description: string;
}

const DEFAULT_CONFIG: Record<string, string> = {
  'app.name': 'EquipChain API',
  'app.version': '1.0.0',
  'app.description': 'Utility meter monitoring and data access platform',
  'meters.defaultInterval': '3600',
  'meters.maxReadingAge': '7776000',
  'meters.dataRetentionDays': '365',
  'analytics.defaultAggregation': 'avg',
  'analytics.cacheTTL': '3600',
  'auth.tokenExpiry': '3600',
  'auth.maxLoginAttempts': '5',
  'auth.lockoutDuration': '900',
  'rateLimit.window': '900000',
  'rateLimit.max': '100',
  'webhook.maxRetries': '3',
  'webhook.retryDelay': '5000',
  'webhook.timeout': '10000',
  'monitoring.logLevel': 'info',
  'monitoring.otelEnabled': 'true',
};

export class ConfigRepository extends BaseRepository<ConfigEntity> {
  constructor() {
    super({ entityName: 'config' });
    this._allowedFilters = ['group'];
    this._sortableFields = ['key', 'group', 'updatedAt'];
    this._searchableFields = ['key', 'value', 'description'];

    this._seedDefaults();
  }

  private _seedDefaults(): void {
    if (this._store.size === 0) {
      const now = new Date().toISOString();
      for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
        const group = key.split('.')[0];
        const entity: ConfigEntity = {
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

  async get(key: string): Promise<string | null> {
    for (const config of this._store.values()) {
      if (config.key === key) {
        return config.value;
      }
    }
    return null;
  }

  async set(key: string, value: string): Promise<ConfigEntity> {
    for (const config of this._store.values()) {
      if (config.key === key) {
        return this.update(config.id, { value } as Partial<ConfigEntity>) as Promise<ConfigEntity>;
      }
    }

    const group = key.split('.')[0];
    return this.create({ key, value, group } as any);
  }

  async getByGroup(group: string): Promise<Array<{ key: string; value: string }>> {
    return [...this._store.values()]
      .filter((c) => c.group === group)
      .map((c) => ({ key: c.key, value: c.value }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  async getAllConfig(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const config of this._store.values()) {
      result[config.key] = config.value;
    }
    return result;
  }
}

export const configRepository = new ConfigRepository();

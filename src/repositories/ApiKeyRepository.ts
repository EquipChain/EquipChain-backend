import * as crypto from 'crypto';
import { BaseRepository, BaseEntity } from './BaseRepository';

export interface ApiKeyEntity extends BaseEntity {
  key: string;
  name: string;
  userId: string;
  status: string;
  permissions: string[];
  expiresAt: string;
}

export class ApiKeyRepository extends BaseRepository<ApiKeyEntity> {
  constructor() {
    super({ entityName: 'apiKey' });
    this._allowedFilters = ['status', 'userId'];
    this._sortableFields = ['name', 'status', 'createdAt', 'expiresAt'];
    this._searchableFields = ['name', 'key'];

    this._seedDefaults();
  }

  static generateKey(): string {
    return `ek_${crypto.randomBytes(32).toString('hex')}`;
  }

  private _seedDefaults(): void {
    if (this._store.size === 0) {
      const now = new Date().toISOString();
      const devKey: ApiKeyEntity = {
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

  async findByKey(key: string): Promise<ApiKeyEntity | null> {
    for (const apiKey of this._store.values()) {
      if (apiKey.key === key) {
        return { ...apiKey };
      }
    }
    return null;
  }

  async findByUserId(userId: string): Promise<ApiKeyEntity[]> {
    return [...this._store.values()]
      .filter((k) => k.userId === userId)
      .map((k) => ({ ...k }));
  }

  async revokeKey(key: string): Promise<ApiKeyEntity | null> {
    const apiKey = await this.findByKey(key);
    if (!apiKey) return null;
    return this.update(apiKey.id, { status: 'revoked' } as Partial<ApiKeyEntity>);
  }

  async findActive(): Promise<ApiKeyEntity[]> {
    const now = new Date().toISOString();
    return [...this._store.values()]
      .filter((k) => k.status === 'active' && k.expiresAt > now)
      .map((k) => ({ ...k }));
  }

  async create(data: Partial<ApiKeyEntity>): Promise<ApiKeyEntity> {
    const key = data.key || ApiKeyRepository.generateKey();
    return super.create({
      ...data,
      key,
      status: data.status || 'active',
      permissions: data.permissions || ['read'],
      expiresAt: data.expiresAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    } as any);
  }
}

export const apiKeyRepository = new ApiKeyRepository();

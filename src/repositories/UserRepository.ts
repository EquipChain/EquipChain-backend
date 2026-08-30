import { BaseRepository, BaseEntity, QueryParams } from './BaseRepository';

export interface UserEntity extends BaseEntity {
  email: string;
  name: string;
  role: string;
  status: string;
  publicKey: string;
}

export class UserRepository extends BaseRepository<UserEntity> {
  constructor() {
    super({ entityName: 'user' });
    this._allowedFilters = ['role', 'status'];
    this._sortableFields = ['email', 'role', 'createdAt', 'updatedAt'];
    this._searchableFields = ['email', 'name'];
    this._defaultSort = { field: 'createdAt', order: 'desc' as const };

    this._seedDefaults();
  }

  private _seedDefaults(): void {
    if (this._store.size === 0) {
      const now = new Date().toISOString();
      const admin: UserEntity = {
        id: this._generateId(),
        email: 'admin@equipchain.io',
        name: 'EquipChain Admin',
        role: 'admin',
        status: 'active',
        publicKey: 'GADMIN1234567890123456789012345678901234567890123',
        createdAt: now,
        updatedAt: now,
      };
      this._store.set(admin.id, admin);
    }
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    for (const user of this._store.values()) {
      if (user.email === email) {
        return { ...user };
      }
    }
    return null;
  }

  async findByPublicKey(publicKey: string): Promise<UserEntity | null> {
    for (const user of this._store.values()) {
      if (user.publicKey === publicKey) {
        return { ...user };
      }
    }
    return null;
  }
}

export const userRepository = new UserRepository();

/**
 * UserRepository — Admin User Store
 *
 * Manages admin user accounts. Pre-seeds a default admin user on instantiation.
 *
 * Domain-specific methods:
 *   - findByEmail(email)
 *   - findByPublicKey(publicKey)
 */

const BaseRepository = require('./BaseRepository');

class UserRepository extends BaseRepository {
  constructor() {
    super({ entityName: 'user' });
    this._allowedFilters = ['role', 'status'];
    this._sortableFields = ['email', 'role', 'createdAt', 'updatedAt'];
    this._searchableFields = ['email', 'name'];
    this._defaultSort = { field: 'createdAt', order: 'desc' };

    this._seedDefaults();
  }

  /**
   * Pre-seed a default admin user.
   */
  _seedDefaults() {
    if (this._store.size === 0) {
      const now = new Date().toISOString();
      const admin = {
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

  /**
   * Find a user by their email address.
   * @param {string} email
   * @returns {Promise<Object|null>}
   */
  async findByEmail(email) {
    for (const user of this._store.values()) {
      if (user.email === email) {
        return { ...user };
      }
    }
    return null;
  }

  /**
   * Find a user by their Stellar public key.
   * @param {string} publicKey
   * @returns {Promise<Object|null>}
   */
  async findByPublicKey(publicKey) {
    for (const user of this._store.values()) {
      if (user.publicKey === publicKey) {
        return { ...user };
      }
    }
    return null;
  }
}

module.exports = UserRepository;

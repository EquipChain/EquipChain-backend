/**
 * BaseRepository — Generic In-Memory Repository
 *
 * Provides a standard interface for data access operations: create, read, update,
 * delete, and query with filtering, sorting, search, and pagination.
 *
 * All domain repositories extend this class. For MVP, data is stored in-memory
 * using a Map. The interface is designed to be swappable with database-backed
 * implementations without changing business logic.
 *
 * Usage:
 *   class UserRepository extends BaseRepository {
 *     constructor() { super({ entityName: 'user' }); }
 *     async findByEmail(email) { ... }
 *   }
 *
 * @template T
 */

const { paginateAndFilter } = require('../utils/pagination');

class BaseRepository {
  /**
   * @param {{ entityName?: string }} [options]
   */
  constructor(options = {}) {
    /** @type {Map<string, T>} */
    this._store = new Map();
    this._nextId = 1;
    this._entityName = options.entityName || 'entity';

    /** @type {Array<{ event: string, handler: Function }>} */
    this._listeners = [];
  }

  // ---------------------------------------------------------------------------
  // ID Generation
  // ---------------------------------------------------------------------------

  /**
   * Generate the next auto-incrementing ID as a string.
   * @returns {string}
   */
  _generateId() {
    return String(this._nextId++);
  }

  // ---------------------------------------------------------------------------
  // Event Emission
  // ---------------------------------------------------------------------------

  /**
   * Register an event listener.
   * @param {'created'|'updated'|'deleted'} event
   * @param {Function} handler — receives (entity, repository)
   */
  on(event, handler) {
    this._listeners.push({ event, handler });
  }

  /**
   * Remove all listeners for a given event.
   * @param {'created'|'updated'|'deleted'} event
   */
  off(event) {
    this._listeners = this._listeners.filter((l) => l.event !== event);
  }

  /**
   * Emit an event to all registered listeners.
   * @param {'created'|'updated'|'deleted'} event
   * @param {Object} data
   */
  _emit(event, data) {
    for (const listener of this._listeners) {
      if (listener.event === event) {
        listener.handler(data, this);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD Operations
  // ---------------------------------------------------------------------------

  /**
   * Create a new entity with auto-generated ID and createdAt timestamp.
   * @param {Object} data — entity data (without id, createdAt)
   * @returns {Promise<Object>} The created entity with id and timestamps
   */
  async create(data) {
    const now = new Date().toISOString();
    const entity = {
      id: this._generateId(),
      ...data,
      createdAt: data.createdAt || now,
      updatedAt: now,
    };
    this._store.set(entity.id, entity);
    this._emit('created', entity);
    return { ...entity };
  }

  /**
   * Find an entity by its ID.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async findById(id) {
    const entity = this._store.get(id);
    return entity ? { ...entity } : null;
  }

  /**
   * Find all entities matching the given query. Supports pagination, filtering,
   * sorting, and keyword search by reusing the pagination utilities.
   *
   * @param {Object} [query]
   * @param {Object} [options] — Optional overrides for allowedFilters, sortableFields,
   *   searchableFields, defaultSort, maxLimit, dateField
   * @returns {Promise<{ data: Array, pagination: Object }>}
   */
  async findAll(query = {}, options = {}) {
    const data = [...this._store.values()];

    const mergedOptions = {
      allowedFilters: this._allowedFilters || [],
      sortableFields: this._sortableFields || [],
      searchableFields: this._searchableFields || [],
      defaultSort: this._defaultSort || {},
      ...options,
    };

    return paginateAndFilter(data, query, mergedOptions);
  }

  /**
   * Update an existing entity by ID. Merges the provided data with the existing entity.
   * @param {string} id
   * @param {Object} data — Fields to update
   * @returns {Promise<Object|null>} The updated entity, or null if not found
   */
  async update(id, data) {
    const existing = this._store.get(id);
    if (!existing) return null;

    const updated = {
      ...existing,
      ...data,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this._store.set(id, updated);
    this._emit('updated', updated);
    return { ...updated };
  }

  /**
   * Delete an entity by ID.
   * @param {string} id
   * @returns {Promise<boolean>} Whether an entity was deleted
   */
  async delete(id) {
    const existed = this._store.has(id);
    if (!existed) return false;

    this._store.delete(id);
    this._emit('deleted', { id });
    return true;
  }

  /**
   * Return the total number of entities in the store.
   * @returns {Promise<number>}
   */
  async count() {
    return this._store.size;
  }

  /**
   * Clear all entities from the store (useful for testing).
   */
  async clear() {
    this._store.clear();
    this._nextId = 1;
  }

  /**
   * Seed initial data into the repository. Clears existing data first.
   * @param {Array<Object>} items
   */
  async seed(items) {
    await this.clear();
    for (const item of items) {
      await this.create(item);
    }
  }

  /**
   * Get all entities as a plain array (bypasses pagination, useful for bulk operations).
   * @returns {Promise<Array>}
   */
  async getAll() {
    return [...this._store.values()].map((e) => ({ ...e }));
  }
}

module.exports = BaseRepository;

'use strict';

// src/repositories/BaseRepository.js
//
// CommonJS port of the repository base class (previously BaseRepository.ts).
// The TypeScript migration was never wired to a build step, which left
// `require('../repositories')` broken and the domain tests failing. This file
// preserves the exact public surface of the TS version:
//   create / findById / findAll / update / delete / count / clear / seed /
//   getAll / on / off
// with copy-on-read semantics (callers can never mutate internal state).

const { paginateAndFilter } = require('../utils/pagination');

class BaseRepository {
  /**
   * @param {Object} [options]
   * @param {string} [options.entityName]
   */
  constructor(options = {}) {
    this._store = new Map();
    this._nextId = 1;
    this._entityName = options.entityName || 'entity';
    this._listeners = [];
    this._allowedFilters = [];
    this._sortableFields = [];
    this._searchableFields = [];
    this._defaultSort = {};
  }

  _generateId() {
    return String(this._nextId++);
  }

  /**
   * Subscribe to lifecycle events ('created' | 'updated' | 'deleted').
   * @param {string} event
   * @param {(entity: Object, repository: BaseRepository) => void} handler
   */
  on(event, handler) {
    this._listeners.push({ event, handler });
  }

  /**
   * Remove all listeners for an event.
   * @param {string} event
   */
  off(event) {
    this._listeners = this._listeners.filter((l) => l.event !== event);
  }

  _emit(event, data) {
    for (const listener of this._listeners) {
      if (listener.event === event) {
        listener.handler(data, this);
      }
    }
  }

  /**
   * Create an entity with an auto-generated id and timestamps.
   * @param {Object} data
   * @returns {Promise<Object>} a defensive copy of the stored entity
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
   * Fetch one entity by id. Returns a copy, not a reference.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async findById(id) {
    const entity = this._store.get(id);
    return entity ? { ...entity } : null;
  }

  /**
   * List entities with the shared search/filter/sort/paginate pipeline.
   * @param {Object} [query]
   * @param {Object} [options]
   * @returns {Promise<{ data: Object[], pagination: Object }>}
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
   * Patch an entity. id and createdAt are preserved; updatedAt is refreshed.
   * @param {string} id
   * @param {Object} data
   * @returns {Promise<Object|null>} a defensive copy, or null when missing
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
   * Delete an entity by id.
   * @param {string} id
   * @returns {Promise<boolean>} true when the entity existed
   */
  async delete(id) {
    const existed = this._store.has(id);
    if (!existed) return false;

    this._store.delete(id);
    this._emit('deleted', { id });
    return true;
  }

  async count() {
    return this._store.size;
  }

  /**
   * Remove all entities and reset the id counter.
   */
  async clear() {
    this._store.clear();
    this._nextId = 1;
  }

  /**
   * Replace all data with the given seed items.
   * @param {Object[]} items
   */
  async seed(items) {
    await this.clear();
    for (const item of items) {
      await this.create(item);
    }
  }

  /**
   * All entities as defensive copies (no pagination).
   * @returns {Promise<Object[]>}
   */
  async getAll() {
    return [...this._store.values()].map((e) => ({ ...e }));
  }
}

module.exports = BaseRepository;
module.exports.BaseRepository = BaseRepository;

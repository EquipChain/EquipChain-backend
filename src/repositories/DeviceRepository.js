'use strict';

// src/repositories/DeviceRepository.js
// CommonJS port of DeviceRepository.ts (part of restoring the broken
// repository layer after the unfinished TypeScript migration).

const BaseRepository = require('./BaseRepository');

const DEFAULT_DEVICES = [
  {
    meterId: 'METER-001',
    name: 'Main Building',
    type: 'electricity',
    location: 'Building A, Floor 1',
    status: 'online',
    lastReading: null,
    config: { baseLoad: 150, interval: 3600 },
  },
  {
    meterId: 'METER-002',
    name: 'Warehouse',
    type: 'electricity',
    location: 'Warehouse Zone B',
    status: 'online',
    lastReading: null,
    config: { baseLoad: 80, interval: 3600 },
  },
  {
    meterId: 'METER-003',
    name: 'Office Wing',
    type: 'electricity',
    location: 'Building A, Floor 2-4',
    status: 'offline',
    lastReading: null,
    config: { baseLoad: 100, interval: 3600 },
  },
];

class DeviceRepository extends BaseRepository {
  constructor() {
    super({ entityName: 'device' });
    this._allowedFilters = ['type', 'status', 'location'];
    this._sortableFields = ['meterId', 'name', 'type', 'status', 'createdAt'];
    this._searchableFields = ['name', 'meterId', 'location'];
    this._defaultSort = { field: 'meterId', order: 'asc' };

    this._seedDefaults();
  }

  _seedDefaults() {
    if (this._store.size === 0) {
      const now = new Date().toISOString();
      for (const device of DEFAULT_DEVICES) {
        const entity = {
          id: this._generateId(),
          ...device,
          createdAt: now,
          updatedAt: now,
        };
        this._store.set(entity.id, entity);
      }
    }
  }

  /**
   * @param {string} meterId
   * @returns {Promise<Object|null>}
   */
  async findByMeterId(meterId) {
    for (const device of this._store.values()) {
      if (device.meterId === meterId) {
        return { ...device };
      }
    }
    return null;
  }

  /**
   * @param {string} status
   * @returns {Promise<Object[]>}
   */
  async findByStatus(status) {
    return [...this._store.values()]
      .filter((d) => d.status === status)
      .map((d) => ({ ...d }));
  }

  async findOnline() {
    return this.findByStatus('online');
  }

  async findOffline() {
    return this.findByStatus('offline');
  }
}

module.exports = DeviceRepository;
module.exports.DeviceRepository = DeviceRepository;
module.exports.deviceRepository = new DeviceRepository();

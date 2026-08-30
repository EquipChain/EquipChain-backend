import { BaseRepository, BaseEntity } from './BaseRepository';

export interface DeviceEntity extends BaseEntity {
  meterId: string;
  name: string;
  type: string;
  location: string;
  status: string;
  lastReading: any | null;
  config: {
    baseLoad: number;
    interval: number;
  };
}

const DEFAULT_DEVICES: Omit<DeviceEntity, 'id' | 'createdAt' | 'updatedAt'>[] = [
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

export class DeviceRepository extends BaseRepository<DeviceEntity> {
  constructor() {
    super({ entityName: 'device' });
    this._allowedFilters = ['type', 'status', 'location'];
    this._sortableFields = ['meterId', 'name', 'type', 'status', 'createdAt'];
    this._searchableFields = ['name', 'meterId', 'location'];
    this._defaultSort = { field: 'meterId', order: 'asc' as const };

    this._seedDefaults();
  }

  private _seedDefaults(): void {
    if (this._store.size === 0) {
      const now = new Date().toISOString();
      for (const device of DEFAULT_DEVICES) {
        const entity: DeviceEntity = {
          id: this._generateId(),
          ...device,
          createdAt: now,
          updatedAt: now,
        };
        this._store.set(entity.id, entity);
      }
    }
  }

  async findByMeterId(meterId: string): Promise<DeviceEntity | null> {
    for (const device of this._store.values()) {
      if (device.meterId === meterId) {
        return { ...device };
      }
    }
    return null;
  }

  async findByStatus(status: string): Promise<DeviceEntity[]> {
    return [...this._store.values()]
      .filter((d) => d.status === status)
      .map((d) => ({ ...d }));
  }

  async findOnline(): Promise<DeviceEntity[]> {
    return this.findByStatus('online');
  }

  async findOffline(): Promise<DeviceEntity[]> {
    return this.findByStatus('offline');
  }
}

export const deviceRepository = new DeviceRepository();

import { BaseRepository, BaseEntity, QueryParams } from './BaseRepository';

export interface MeterReadingEntity extends BaseEntity {
  meterId: string;
  timestamp: number;
  value: number;
  unit: string;
}

export interface DateRange {
  startDate?: string | number;
  endDate?: string | number;
}

export interface ReadingFilters extends DateRange {
  meterIds?: string[];
}

export class MeterReadingRepository extends BaseRepository<MeterReadingEntity> {
  constructor() {
    super({ entityName: 'meterReading' });
    this._allowedFilters = ['meterId'];
    this._sortableFields = ['meterId', 'timestamp', 'value', 'createdAt'];
    this._searchableFields = ['meterId'];
    this._defaultSort = { field: 'timestamp', order: 'desc' as const };
  }

  async findByMeterId(meterId: string, dateRange: DateRange = {}): Promise<MeterReadingEntity[]> {
    let results = [...this._store.values()].filter((r) => r.meterId === meterId);

    if (dateRange.startDate) {
      const start = typeof dateRange.startDate === 'number'
        ? dateRange.startDate
        : new Date(dateRange.startDate).getTime();
      results = results.filter((r) => r.timestamp >= start);
    }

    if (dateRange.endDate) {
      const endDate = new Date(dateRange.endDate);
      endDate.setUTCHours(23, 59, 59, 999);
      results = results.filter((r) => r.timestamp <= endDate.getTime());
    }

    return results.map((r) => ({ ...r }));
  }

  async findByDateRange(startDate: string | number, endDate: string | number): Promise<MeterReadingEntity[]> {
    const start = typeof startDate === 'number' ? startDate : new Date(startDate).getTime();
    const endOfDay = new Date(endDate);
    endOfDay.setUTCHours(23, 59, 59, 999);
    const end = endOfDay.getTime();

    return [...this._store.values()]
      .filter((r) => r.timestamp >= start && r.timestamp <= end)
      .map((r) => ({ ...r }));
  }

  async getReadings(filters: ReadingFilters = {}): Promise<MeterReadingEntity[]> {
    let result = [...this._store.values()];

    if (filters.meterIds && filters.meterIds.length > 0) {
      result = result.filter((r) => filters.meterIds!.includes(r.meterId));
    }

    if (filters.startDate) {
      const start = typeof filters.startDate === 'number'
        ? filters.startDate
        : new Date(filters.startDate).getTime();
      result = result.filter((r) => r.timestamp >= start);
    }

    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setUTCHours(23, 59, 59, 999);
      result = result.filter((r) => r.timestamp <= endDate.getTime());
    }

    return result.map((r) => ({ ...r }));
  }

  async addReadings(data: any | any[]): Promise<any | any[]> {
    const items = Array.isArray(data) ? data : [data];
    const stored: MeterReadingEntity[] = [];
    for (const item of items) {
      const reading = await this.create({
        meterId: item.meterId,
        timestamp: typeof item.timestamp === 'number' ? item.timestamp : new Date(item.timestamp).getTime(),
        value: Number(item.value),
        unit: item.unit || 'kWh',
      });
      stored.push(reading);
    }
    return stored.length === 1 ? stored[0] : stored;
  }

  async clearReadings(): Promise<void> {
    await this.clear();
  }

  async readingCount(): Promise<number> {
    return this._store.size;
  }
}

export const meterReadingRepository = new MeterReadingRepository();

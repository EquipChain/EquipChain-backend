import { paginateAndFilter } from '../utils/pagination';

export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryOptions {
  entityName?: string;
}

export interface FindAllOptions {
  allowedFilters?: string[];
  sortableFields?: string[];
  searchableFields?: string[];
  defaultSort?: { field?: string; order?: 'asc' | 'desc' };
  maxLimit?: number;
  dateField?: string;
}

export interface QueryParams {
  page?: number | string;
  limit?: number | string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  q?: string;
  createdAfter?: string;
  createdBefore?: string;
  [key: string]: any;
}

type EventType = 'created' | 'updated' | 'deleted';
type EventHandler<T extends BaseEntity> = (entity: T, repository: BaseRepository<T>) => void;

export class BaseRepository<T extends BaseEntity> {
  protected _store: Map<string, T>;
  protected _nextId: number;
  protected _entityName: string;
  protected _listeners: Array<{ event: EventType; handler: EventHandler<T> }>;
  protected _allowedFilters: string[];
  protected _sortableFields: string[];
  protected _searchableFields: string[];
  protected _defaultSort: { field?: string; order?: 'asc' | 'desc' };

  constructor(options: RepositoryOptions = {}) {
    this._store = new Map();
    this._nextId = 1;
    this._entityName = options.entityName || 'entity';
    this._listeners = [];
    this._allowedFilters = [];
    this._sortableFields = [];
    this._searchableFields = [];
    this._defaultSort = {};
  }

  protected _generateId(): string {
    return String(this._nextId++);
  }

  on(event: EventType, handler: EventHandler<T>): void {
    this._listeners.push({ event, handler });
  }

  off(event: EventType): void {
    this._listeners = this._listeners.filter((l) => l.event !== event);
  }

  protected _emit(event: EventType, data: T): void {
    for (const listener of this._listeners) {
      if (listener.event === event) {
        listener.handler(data, this);
      }
    }
  }

  async create(data: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & Partial<BaseEntity>): Promise<T> {
    const now = new Date().toISOString();
    const entity = {
      id: this._generateId(),
      ...data,
      createdAt: data.createdAt || now,
      updatedAt: now,
    } as T;
    this._store.set(entity.id, entity);
    this._emit('created', entity);
    return { ...entity };
  }

  async findById(id: string): Promise<T | null> {
    const entity = this._store.get(id);
    return entity ? { ...entity } : null;
  }

  async findAll(query: QueryParams = {}, options: FindAllOptions = {}): Promise<{ data: T[]; pagination: any }> {
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

  async update(id: string, data: Partial<T>): Promise<T | null> {
    const existing = this._store.get(id);
    if (!existing) return null;

    const updated = {
      ...existing,
      ...data,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    } as T;
    this._store.set(id, updated);
    this._emit('updated', updated);
    return { ...updated };
  }

  async delete(id: string): Promise<boolean> {
    const existed = this._store.has(id);
    if (!existed) return false;

    this._store.delete(id);
    this._emit('deleted', { id } as unknown as T);
    return true;
  }

  async count(): Promise<number> {
    return this._store.size;
  }

  async clear(): Promise<void> {
    this._store.clear();
    this._nextId = 1;
  }

  async seed(items: Array<Omit<T, 'id' | 'createdAt' | 'updatedAt'> & Partial<BaseEntity>>): Promise<void> {
    await this.clear();
    for (const item of items) {
      await this.create(item);
    }
  }

  async getAll(): Promise<T[]> {
    return [...this._store.values()].map((e) => ({ ...e }));
  }
}

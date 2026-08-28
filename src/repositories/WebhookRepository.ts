import { BaseRepository, BaseEntity } from './BaseRepository';

export interface WebhookEntity extends BaseEntity {
  url: string;
  event: string;
  status: string;
  description?: string;
}

export interface DeliveryLog {
  timestamp: string;
  statusCode: number;
  response: any | null;
}

export class WebhookRepository extends BaseRepository<WebhookEntity> {
  private _deliveryLogs: Map<string, DeliveryLog[]>;

  constructor() {
    super({ entityName: 'webhook' });
    this._allowedFilters = ['event', 'status'];
    this._sortableFields = ['url', 'event', 'status', 'createdAt'];
    this._searchableFields = ['url', 'description'];
    this._deliveryLogs = new Map();
  }

  async findByEvent(event: string): Promise<WebhookEntity[]> {
    return [...this._store.values()]
      .filter((w) => w.event === event && w.status === 'active')
      .map((w) => ({ ...w }));
  }

  async findByUrl(url: string): Promise<WebhookEntity | null> {
    for (const webhook of this._store.values()) {
      if (webhook.url === url) {
        return { ...webhook };
      }
    }
    return null;
  }

  async findByStatus(status: string): Promise<WebhookEntity[]> {
    return [...this._store.values()]
      .filter((w) => w.status === status)
      .map((w) => ({ ...w }));
  }

  async logDelivery(webhookId: string, statusCode: number, response?: any): Promise<void> {
    if (!this._deliveryLogs.has(webhookId)) {
      this._deliveryLogs.set(webhookId, []);
    }
    this._deliveryLogs.get(webhookId)!.push({
      timestamp: new Date().toISOString(),
      statusCode,
      response: response || null,
    });
  }

  async getDeliveryLogs(webhookId: string): Promise<DeliveryLog[]> {
    return this._deliveryLogs.get(webhookId) || [];
  }

  async clearDeliveryLogs(): Promise<void> {
    this._deliveryLogs.clear();
  }

  async clear(): Promise<void> {
    await super.clear();
    this._deliveryLogs.clear();
  }
}

export const webhookRepository = new WebhookRepository();

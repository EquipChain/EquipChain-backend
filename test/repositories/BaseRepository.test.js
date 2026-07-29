const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const BaseRepository = require('../../src/repositories/BaseRepository');

describe('BaseRepository', () => {
  /** @type {BaseRepository} */
  let repo;

  before(() => {
    repo = new BaseRepository({ entityName: 'test' });
  });

  after(async () => {
    await repo.clear();
  });

  describe('create', () => {
    it('creates an entity with auto-generated id and timestamps', async () => {
      const entity = await repo.create({ name: 'Test', value: 42 });
      assert.ok(entity.id);
      assert.strictEqual(entity.name, 'Test');
      assert.strictEqual(entity.value, 42);
      assert.ok(entity.createdAt);
      assert.ok(entity.updatedAt);
    });

    it('increments IDs sequentially', async () => {
      await repo.clear();
      const a = await repo.create({ name: 'A' });
      const b = await repo.create({ name: 'B' });
      assert.strictEqual(Number(b.id), Number(a.id) + 1);
    });
  });

  describe('findById', () => {
    it('returns the entity by ID', async () => {
      const created = await repo.create({ name: 'Find Me' });
      const found = await repo.findById(created.id);
      assert.strictEqual(found.name, 'Find Me');
    });

    it('returns null for non-existent ID', async () => {
      const found = await repo.findById('nonexistent');
      assert.strictEqual(found, null);
    });

    it('returns a copy, not a reference', async () => {
      const created = await repo.create({ name: 'Original' });
      const found = await repo.findById(created.id);
      found.name = 'Modified';
      const refetched = await repo.findById(created.id);
      assert.strictEqual(refetched.name, 'Original');
    });
  });

  describe('findAll', () => {
    it('returns all entities with pagination metadata', async () => {
      await repo.clear();
      await repo.create({ name: 'A' });
      await repo.create({ name: 'B' });
      await repo.create({ name: 'C' });

      const result = await repo.findAll();
      assert.strictEqual(result.data.length, 3);
      assert.ok(result.pagination);
      assert.strictEqual(result.pagination.total, 3);
    });

    it('supports pagination via page and limit', async () => {
      await repo.clear();
      for (let i = 0; i < 10; i++) {
        await repo.create({ name: `Item ${i}` });
      }

      const page1 = await repo.findAll({ page: 1, limit: 3 });
      assert.strictEqual(page1.data.length, 3);
      assert.strictEqual(page1.pagination.page, 1);
      assert.strictEqual(page1.pagination.total, 10);

      const page2 = await repo.findAll({ page: 2, limit: 3 });
      assert.strictEqual(page2.data.length, 3);
      assert.strictEqual(page2.pagination.page, 2);
    });
  });

  describe('update', () => {
    it('updates an existing entity', async () => {
      const created = await repo.create({ name: 'Old' });
      const updated = await repo.update(created.id, { name: 'New' });
      assert.strictEqual(updated.name, 'New');
      assert.strictEqual(updated.id, created.id);
    });

    it('preserves createdAt on update', async () => {
      const created = await repo.create({ name: 'Test' });
      // Small delay to ensure updatedAt differs from createdAt
      await new Promise((r) => setTimeout(r, 5));
      const updated = await repo.update(created.id, { name: 'Updated' });
      assert.strictEqual(updated.createdAt, created.createdAt);
      assert.ok(new Date(updated.updatedAt) > new Date(updated.createdAt));
    });

    it('returns null for non-existent entity', async () => {
      const result = await repo.update('nonexistent', { name: 'Test' });
      assert.strictEqual(result, null);
    });
  });

  describe('delete', () => {
    it('deletes an entity and returns true', async () => {
      const created = await repo.create({ name: 'Delete Me' });
      const deleted = await repo.delete(created.id);
      assert.strictEqual(deleted, true);
      const found = await repo.findById(created.id);
      assert.strictEqual(found, null);
    });

    it('returns false for non-existent entity', async () => {
      const result = await repo.delete('nonexistent');
      assert.strictEqual(result, false);
    });
  });

  describe('count', () => {
    it('returns the total number of entities', async () => {
      await repo.clear();
      await repo.create({ name: 'A' });
      await repo.create({ name: 'B' });
      const count = await repo.count();
      assert.strictEqual(count, 2);
    });
  });

  describe('clear', () => {
    it('removes all entities and resets ID counter', async () => {
      await repo.create({ name: 'A' });
      await repo.create({ name: 'B' });
      await repo.clear();
      assert.strictEqual(await repo.count(), 0);
      const first = await repo.create({ name: 'First after clear' });
      assert.strictEqual(first.id, '1');
    });
  });

  describe('seed', () => {
    it('replaces all data with seed items', async () => {
      await repo.clear();
      await repo.seed([
        { name: 'Seed A' },
        { name: 'Seed B' },
        { name: 'Seed C' },
      ]);
      const count = await repo.count();
      assert.strictEqual(count, 3);
    });
  });

  describe('events', () => {
    it('emits created event', async () => {
      let emitted = null;
      repo.on('created', (entity) => { emitted = entity; });
      const created = await repo.create({ name: 'Event Test' });
      assert.ok(emitted);
      assert.strictEqual(emitted.id, created.id);
    });

    it('emits updated event', async () => {
      let emitted = null;
      repo.on('updated', (entity) => { emitted = entity; });
      const created = await repo.create({ name: 'Before' });
      await repo.update(created.id, { name: 'After' });
      assert.strictEqual(emitted.name, 'After');
    });

    it('emits deleted event', async () => {
      let emitted = null;
      repo.on('deleted', (data) => { emitted = data; });
      const created = await repo.create({ name: 'Delete Event' });
      await repo.delete(created.id);
      assert.strictEqual(emitted.id, created.id);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Collection, Store, type Entity } from './store.js';

interface User extends Entity {
  name: string;
  email?: string;
  status?: string;
}

describe('Collection', () => {
  describe('CRUD', () => {
    let col: Collection<User>;

    beforeEach(() => {
      col = new Collection<User>('user');
    });

    it('insert returns item with string ID and timestamps; get retrieves by id', () => {
      const item = col.insert({ name: 'alice' });
      expect(item.id).toMatch(/^user_/);
      expect(item.id.length).toBeGreaterThan(5);
      expect(item.created_at).toBe(item.updated_at);
      expect(new Date(item.created_at).toString()).not.toBe('Invalid Date');
      expect(col.get(item.id)).toEqual(item);
    });

    it('insert with explicit ID uses the provided ID', () => {
      const item = col.insert({ id: 'user_custom123', name: 'bob' });
      expect(item.id).toBe('user_custom123');
      expect(col.get('user_custom123')).toEqual(item);
    });

    it('update merges data and updates updated_at; delete removes item', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));
      const inserted = col.insert({ name: 'bob' });
      const createdAt = inserted.created_at;

      vi.setSystemTime(new Date('2020-01-02T00:00:00.000Z'));
      const updated = col.update(inserted.id, { name: 'robert', status: 'active' });
      expect(updated).toBeDefined();
      expect(updated!.name).toBe('robert');
      expect(updated!.status).toBe('active');
      expect(updated!.id).toBe(inserted.id);
      expect(updated!.created_at).toBe(createdAt);
      expect(updated!.updated_at).not.toBe(createdAt);

      expect(col.delete(inserted.id)).toBe(true);
      expect(col.get(inserted.id)).toBeUndefined();
      vi.useRealTimers();
    });

    it('update returns undefined for nonexistent ID', () => {
      expect(col.update('nonexistent', { name: 'x' })).toBeUndefined();
    });

    it('delete returns false for nonexistent ID', () => {
      expect(col.delete('nonexistent')).toBe(false);
    });
  });

  describe('unique string IDs', () => {
    it('generates unique IDs for successive inserts', () => {
      const col = new Collection<User>('user');
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) {
        ids.add(col.insert({ name: `user-${i}` }).id);
      }
      expect(ids.size).toBe(50);
    });

    it('all generated IDs have the correct prefix', () => {
      const col = new Collection<User>('org');
      for (let i = 0; i < 10; i++) {
        expect(col.insert({ name: `org-${i}` }).id).toMatch(/^org_/);
      }
    });
  });

  describe('index lookups', () => {
    it('findBy uses indexes when indexFields are provided', () => {
      const col = new Collection<User>('user', ['name']);
      col.insert({ name: 'dup', status: 'a' });
      col.insert({ name: 'dup', status: 'b' });
      col.insert({ name: 'other' });

      const matches = col.findBy('name', 'dup');
      expect(matches).toHaveLength(2);
      expect(matches.map((m) => m.status).sort()).toEqual(['a', 'b']);
    });

    it('findOneBy returns the first match', () => {
      const col = new Collection<User>('user', ['name']);
      const first = col.insert({ name: 'same' });
      col.insert({ name: 'same' });

      const one = col.findOneBy('name', 'same');
      expect(one).toBeDefined();
      expect(one!.id).toBe(first.id);
    });

    it('index updates when item is updated', () => {
      const col = new Collection<User>('user', ['email']);
      const item = col.insert({ name: 'alice', email: 'alice@test.com' });
      expect(col.findBy('email', 'alice@test.com')).toHaveLength(1);

      col.update(item.id, { email: 'new@test.com' });
      expect(col.findBy('email', 'alice@test.com')).toHaveLength(0);
      expect(col.findBy('email', 'new@test.com')).toHaveLength(1);
    });

    it('index updates when item is deleted', () => {
      const col = new Collection<User>('user', ['name']);
      const item = col.insert({ name: 'toDelete' });
      expect(col.findBy('name', 'toDelete')).toHaveLength(1);

      col.delete(item.id);
      expect(col.findBy('name', 'toDelete')).toHaveLength(0);
    });
  });

  describe('cursor pagination via list()', () => {
    let col: Collection<User>;

    beforeEach(() => {
      col = new Collection<User>('user');
      for (let i = 1; i <= 25; i++) {
        col.insert({ name: `user-${i}` });
      }
    });

    it('returns first page with default settings', () => {
      const r = col.list();
      expect(r.data).toHaveLength(10);
    });

    it('paginates forward through all items', () => {
      const allIds: string[] = [];
      let after: string | undefined;

      for (let page = 0; page < 10; page++) {
        const r = col.list({ limit: 10, order: 'asc', after });
        allIds.push(...r.data.map((i) => i.id));
        if (!r.list_metadata.after) break;
        after = r.list_metadata.after;
      }

      expect(new Set(allIds).size).toBe(25);
    });
  });

  describe('count', () => {
    it('returns total size without filter and filtered count with filter', () => {
      const col = new Collection<User>('user');
      col.insert({ name: 'a' });
      col.insert({ name: 'b' });
      col.insert({ name: 'c' });

      expect(col.count()).toBe(3);
      expect(col.count((u) => u.name === 'b')).toBe(1);
    });
  });

  describe('clear', () => {
    it('resets items and indexes', () => {
      const col = new Collection<User>('user', ['name']);
      col.insert({ name: 'x' });
      col.insert({ name: 'y' });
      expect(col.findBy('name', 'x')).toHaveLength(1);

      col.clear();
      expect(col.all()).toHaveLength(0);
      expect(col.findBy('name', 'x')).toHaveLength(0);
    });
  });
});

describe('Store', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  it('collection returns the same Collection for the same name', () => {
    const a = store.collection<User>('users', 'user');
    const b = store.collection<User>('users', 'user');
    expect(a).toBe(b);
  });

  it('throws when re-requesting collection with different indexes', () => {
    store.collection<User>('users', 'user', ['name']);
    expect(() => store.collection<User>('users', 'user', ['email'])).toThrow(/already exists with indexes/);
  });

  it('reset clears all collections and data', () => {
    const u = store.collection<User>('users', 'user');
    u.insert({ name: 'u' });
    store.setData('key', 'value');

    store.reset();
    expect(u.all()).toHaveLength(0);
    expect(store.getData('key')).toBeUndefined();
  });

  it('getData/setData stores arbitrary values', () => {
    store.setData('session', { token: 'abc' });
    expect(store.getData<{ token: string }>('session')).toEqual({ token: 'abc' });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

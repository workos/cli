import { generateId } from './id.js';
import { cursorPaginate, type Entity, type CursorPaginationOptions, type CursorPaginatedResult } from './pagination.js';

export type { Entity };

export type InsertInput<T extends Entity> = Omit<T, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
};

export type FilterFn<T> = (item: T) => boolean;
export type SortFn<T> = (a: T, b: T) => number;

export interface CollectionHooks<T extends Entity> {
  onInsert?: (item: T) => void;
  onUpdate?: (item: T) => void;
  onDelete?: (item: T) => void;
}

export class Collection<T extends Entity> {
  private items = new Map<string, T>();
  private indexes = new Map<string, Map<string, Set<string>>>();
  private hooks: CollectionHooks<T> = {};
  readonly fieldNames: string[];

  constructor(
    private prefix: string,
    private indexFields: (keyof T)[] = [],
  ) {
    this.fieldNames = indexFields.map(String).sort();
    for (const field of indexFields) {
      this.indexes.set(String(field), new Map());
    }
  }

  private addToIndex(item: T): void {
    for (const field of this.indexFields) {
      const value = item[field];
      if (value === undefined || value === null) continue;
      const indexMap = this.indexes.get(String(field))!;
      const key = String(value);
      if (!indexMap.has(key)) {
        indexMap.set(key, new Set());
      }
      indexMap.get(key)!.add(item.id);
    }
  }

  private removeFromIndex(item: T): void {
    for (const field of this.indexFields) {
      const value = item[field];
      if (value === undefined || value === null) continue;
      const indexMap = this.indexes.get(String(field))!;
      const key = String(value);
      indexMap.get(key)?.delete(item.id);
    }
  }

  insert(data: InsertInput<T>): T {
    const now = new Date().toISOString();
    const id = data.id ?? generateId(this.prefix);
    const item = {
      ...data,
      id,
      created_at: now,
      updated_at: now,
    } as unknown as T;
    this.items.set(id, item);
    this.addToIndex(item);
    this.hooks.onInsert?.(item);
    return item;
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  findBy(field: keyof T, value: string | number): T[] {
    if (this.indexes.has(String(field))) {
      const ids = this.indexes.get(String(field))!.get(String(value));
      if (!ids) return [];
      return Array.from(ids)
        .map((id) => this.items.get(id)!)
        .filter(Boolean);
    }
    return this.all().filter((item) => item[field] === value);
  }

  findOneBy(field: keyof T, value: string | number): T | undefined {
    return this.findBy(field, value)[0];
  }

  update(id: string, data: Partial<T>): T | undefined {
    const existing = this.items.get(id);
    if (!existing) return undefined;
    this.removeFromIndex(existing);
    const updated = {
      ...existing,
      ...data,
      id,
      updated_at: new Date().toISOString(),
    } as T;
    this.items.set(id, updated);
    this.addToIndex(updated);
    this.hooks.onUpdate?.(updated);
    return updated;
  }

  delete(id: string): boolean {
    const existing = this.items.get(id);
    if (!existing) return false;
    this.hooks.onDelete?.(existing);
    this.removeFromIndex(existing);
    return this.items.delete(id);
  }

  deleteBy(field: keyof T, value: string | number): number {
    const items = this.findBy(field, value);
    for (const item of items) this.delete(item.id);
    return items.length;
  }

  setHooks(hooks: CollectionHooks<T>): void {
    this.hooks = hooks;
  }

  all(): T[] {
    return Array.from(this.items.values());
  }

  list(options: CursorPaginationOptions<T> = {}): CursorPaginatedResult<T> {
    return cursorPaginate(this.all(), options);
  }

  count(filter?: FilterFn<T>): number {
    if (!filter) return this.items.size;
    let n = 0;
    for (const item of this.items.values()) {
      if (filter(item)) n++;
    }
    return n;
  }

  clear(): void {
    this.items.clear();
    for (const indexMap of this.indexes.values()) {
      indexMap.clear();
    }
  }
}

export class Store {
  private collections = new Map<string, Collection<any>>();
  private _data = new Map<string, unknown>();

  collection<T extends Entity>(name: string, prefix: string, indexFields: (keyof T)[] = []): Collection<T> {
    const existing = this.collections.get(name);
    if (existing) {
      if (indexFields.length > 0) {
        const requested = indexFields.map(String).sort();
        if (existing.fieldNames.length !== requested.length || existing.fieldNames.some((f, i) => f !== requested[i])) {
          throw new Error(
            `Collection "${name}" already exists with indexes [${existing.fieldNames}] but was requested with [${requested}]`,
          );
        }
      }
      return existing as Collection<T>;
    }
    const col = new Collection<T>(prefix, indexFields);
    this.collections.set(name, col);
    return col;
  }

  getData<V>(key: string): V | undefined {
    return this._data.get(key) as V | undefined;
  }

  setData<V>(key: string, value: V): void {
    this._data.set(key, value);
  }

  deleteDataByPrefix(prefix: string): number {
    let count = 0;
    for (const key of this._data.keys()) {
      if (key.startsWith(prefix)) {
        this._data.delete(key);
        count++;
      }
    }
    return count;
  }

  reset(): void {
    for (const collection of this.collections.values()) {
      collection.clear();
    }
    this._data.clear();
  }
}

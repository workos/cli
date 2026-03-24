import { describe, it, expect } from 'vitest';
import { cursorPaginate, type Entity } from './pagination.js';

interface TestItem extends Entity {
  name: string;
}

function makeItems(count: number): TestItem[] {
  const items: TestItem[] = [];
  for (let i = 1; i <= count; i++) {
    const ts = new Date(2024, 0, 1, 0, 0, i).toISOString();
    items.push({
      id: `item_${String(i).padStart(4, '0')}`,
      name: `item-${i}`,
      created_at: ts,
      updated_at: ts,
    });
  }
  return items;
}

describe('cursorPaginate', () => {
  it('returns first page with default limit of 10', () => {
    const result = cursorPaginate(makeItems(25), {});
    expect(result.data).toHaveLength(10);
    expect(result.list_metadata.after).toBeDefined();
    expect(result.list_metadata.before).toBeNull();
  });

  it('returns all items when fewer than limit', () => {
    const result = cursorPaginate(makeItems(5), { limit: 10 });
    expect(result.data).toHaveLength(5);
    expect(result.list_metadata.after).toBeNull();
  });

  it('returns empty result for empty input', () => {
    const result = cursorPaginate([], {});
    expect(result.data).toHaveLength(0);
    expect(result.list_metadata.before).toBeNull();
    expect(result.list_metadata.after).toBeNull();
  });

  it('returns items in desc order by default', () => {
    const result = cursorPaginate(makeItems(5), {});
    expect(result.data[0].name).toBe('item-5');
    expect(result.data[4].name).toBe('item-1');
  });

  it('returns items in asc order when specified', () => {
    const result = cursorPaginate(makeItems(5), { order: 'asc' });
    expect(result.data[0].name).toBe('item-1');
    expect(result.data[4].name).toBe('item-5');
  });

  it('caps limit at 100', () => {
    const result = cursorPaginate(makeItems(150), { limit: 200 });
    expect(result.data).toHaveLength(100);
  });

  it('enforces minimum limit of 1', () => {
    const result = cursorPaginate(makeItems(5), { limit: 0 });
    expect(result.data).toHaveLength(1);
  });

  it('paginates forward with no duplicates', () => {
    const items = makeItems(25);
    const allIds: string[] = [];

    const p1 = cursorPaginate(items, { limit: 10, order: 'asc' });
    allIds.push(...p1.data.map((i) => i.id));

    const p2 = cursorPaginate(items, { limit: 10, order: 'asc', after: p1.list_metadata.after! });
    allIds.push(...p2.data.map((i) => i.id));

    const p3 = cursorPaginate(items, { limit: 10, order: 'asc', after: p2.list_metadata.after! });
    allIds.push(...p3.data.map((i) => i.id));

    expect(new Set(allIds).size).toBe(25);
    expect(allIds).toHaveLength(25);
  });

  it('returns items before the given cursor', () => {
    const items = makeItems(10);
    const full = cursorPaginate(items, { limit: 10, order: 'asc' });
    const fifthId = full.data[4].id;

    const result = cursorPaginate(items, { limit: 10, order: 'asc', before: fifthId });
    expect(result.data).toHaveLength(4);
    expect(result.data.map((i) => i.name)).toEqual(['item-1', 'item-2', 'item-3', 'item-4']);
  });

  it('applies filter before pagination', () => {
    const result = cursorPaginate(makeItems(20), {
      filter: (item) => parseInt(item.name.split('-')[1]) % 2 === 0,
      order: 'asc',
      limit: 100,
    });
    expect(result.data).toHaveLength(10);
    expect(result.data.every((i) => parseInt(i.name.split('-')[1]) % 2 === 0)).toBe(true);
  });
});

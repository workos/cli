import { describe, it, expect, beforeEach } from 'vitest';
import { generateId, resetIdState, ID_PREFIXES } from './id.js';

beforeEach(() => {
  resetIdState();
});

describe('generateId', () => {
  it('generates an ID with the given prefix', () => {
    const id = generateId('user');
    expect(id).toMatch(/^user_[0-9A-Z]{26}$/);
  });

  it('generates IDs with different prefixes', () => {
    expect(generateId('org')).toMatch(/^org_/);
    expect(generateId('conn')).toMatch(/^conn_/);
    expect(generateId('om')).toMatch(/^om_/);
  });

  it('generates 1000 unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateId('user'));
    }
    expect(ids.size).toBe(1000);
  });

  it('generates sortable IDs (creation order)', () => {
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      ids.push(generateId('user'));
    }
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('handles monotonic time correctly', () => {
    const id1 = generateId('user');
    const id2 = generateId('user');
    expect(id1).not.toBe(id2);
    expect(id1 < id2).toBe(true);
  });
});

describe('ID_PREFIXES', () => {
  it('contains expected prefix mappings', () => {
    expect(ID_PREFIXES.user).toBe('user');
    expect(ID_PREFIXES.organization).toBe('org');
    expect(ID_PREFIXES.organization_membership).toBe('om');
    expect(ID_PREFIXES.connection).toBe('conn');
    expect(ID_PREFIXES.session).toBe('session');
  });

  it('has all expected keys', () => {
    const prefixes: Record<string, string> = { ...ID_PREFIXES };
    expect(Object.keys(prefixes).length).toBeGreaterThan(10);
  });
});

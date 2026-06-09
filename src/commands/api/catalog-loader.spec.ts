import { describe, it, expect } from 'vitest';
import { loadCatalogFrom, type CatalogSource } from './catalog.js';

const specWith = (path: string, tag: string) =>
  `openapi: 3.1.0\npaths:\n  ${path}:\n    get:\n      tags: [${tag}]\n      operationId: op\n      summary: s\n`;

const FETCHED = specWith('/fetched', 'Fetched');
const EMBEDDED = specWith('/embedded', 'Embedded');
const CACHED = specWith('/cached', 'Cached');
const UNUSABLE = 'this is not an openapi document';

/** Build a source with sensible defaults + per-test overrides and call tracking. */
function makeSource(over: Partial<CatalogSource> & { calls?: Record<string, number> } = {}): CatalogSource {
  const calls = (over.calls ??= { fetch: 0, write: 0 });
  return {
    ttlMs: 24 * 60 * 60 * 1000,
    readCache: async () => null,
    fetchLatest: async () => {
      calls.fetch++;
      return FETCHED;
    },
    writeCache: async () => {
      calls.write++;
    },
    embedded: EMBEDDED,
    ...over,
  };
}

describe('loadCatalogFrom', () => {
  it('fetches latest and caches it when there is no cache', async () => {
    const calls = { fetch: 0, write: 0 };
    const cat = await loadCatalogFrom(makeSource({ calls }));
    expect(cat.endpoints[0]!.path).toBe('/fetched');
    expect(calls).toEqual({ fetch: 1, write: 1 });
  });

  it('uses a fresh cache without fetching', async () => {
    const calls = { fetch: 0, write: 0 };
    const cat = await loadCatalogFrom(makeSource({ calls, readCache: async () => ({ text: CACHED, ageMs: 1000 }) }));
    expect(cat.endpoints[0]!.path).toBe('/cached');
    expect(calls.fetch).toBe(0);
  });

  it('refetches when the cache is older than the TTL', async () => {
    const calls = { fetch: 0, write: 0 };
    const cat = await loadCatalogFrom(
      makeSource({ calls, ttlMs: 1000, readCache: async () => ({ text: CACHED, ageMs: 5000 }) }),
    );
    expect(cat.endpoints[0]!.path).toBe('/fetched');
    expect(calls.fetch).toBe(1);
  });

  it('falls back to the embedded spec when fetch fails and there is no cache', async () => {
    const cat = await loadCatalogFrom(
      makeSource({
        fetchLatest: async () => {
          throw new Error('offline');
        },
      }),
    );
    expect(cat.endpoints[0]!.path).toBe('/embedded');
  });

  it('prefers a stale cache over the embedded spec when fetch fails', async () => {
    const cat = await loadCatalogFrom(
      makeSource({
        ttlMs: 1000,
        readCache: async () => ({ text: CACHED, ageMs: 5000 }),
        fetchLatest: async () => {
          throw new Error('offline');
        },
      }),
    );
    expect(cat.endpoints[0]!.path).toBe('/cached');
  });

  it('does not cache an unusable fetched spec and falls back to embedded', async () => {
    const calls = { fetch: 0, write: 0 };
    const cat = await loadCatalogFrom(makeSource({ calls, fetchLatest: async () => UNUSABLE }));
    expect(cat.endpoints[0]!.path).toBe('/embedded');
    expect(calls.write).toBe(0);
  });

  it('ignores a corrupt fresh cache and fetches instead', async () => {
    const calls = { fetch: 0, write: 0 };
    const cat = await loadCatalogFrom(makeSource({ calls, readCache: async () => ({ text: UNUSABLE, ageMs: 10 }) }));
    expect(cat.endpoints[0]!.path).toBe('/fetched');
    expect(calls.fetch).toBe(1);
  });
});

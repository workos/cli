import { describe, it, expect } from 'vitest';
import {
  loadManagementCatalog,
  snapshotSource,
  type CatalogSource,
} from './loader.js';
import type { RawManagementCatalog } from './catalog-types.js';

// Visible operation count: 357 in the snapshot minus the 4 feature-flag-gated
// directory mutations the live MCP hides from its index.
const VISIBLE_COUNT = 353;
const TOTAL_COUNT = 357;

describe('loadManagementCatalog', () => {
  it('loads the vendored snapshot as a normalized catalog', () => {
    const catalog = loadManagementCatalog();
    expect(Array.isArray(catalog.operations)).toBe(true);
    expect(catalog.operations.length).toBeGreaterThan(0);
    expect(typeof catalog.fragments).toBe('object');
    expect(typeof catalog.inputTypes).toBe('object');
  });

  it('returns the visible operation count (feature-flagged filtered out)', () => {
    const catalog = loadManagementCatalog();
    expect(catalog.operations.length).toBe(VISIBLE_COUNT);
  });

  it('never returns a feature-flag-gated operation by default', () => {
    const catalog = loadManagementCatalog();
    expect(catalog.operations.some((op) => op.featureFlagGated === true)).toBe(false);
  });

  it('returns the full set when includeFeatureFlagged is true', () => {
    const catalog = loadManagementCatalog(snapshotSource, { includeFeatureFlagged: true });
    expect(catalog.operations.length).toBe(TOTAL_COUNT);
    expect(catalog.operations.some((op) => op.featureFlagGated === true)).toBe(true);
  });

  it('carries fragments and input types through unchanged', () => {
    const raw = snapshotSource.load();
    const catalog = loadManagementCatalog();
    expect(catalog.fragments).toBe(raw.fragments);
    expect(catalog.inputTypes).toBe(raw.inputTypes);
  });

  it('includes known account-plane operations', () => {
    const names = new Set(loadManagementCatalog().operations.map((op) => op.name));
    expect(names.has('createEnvironment')).toBe(true);
    expect(names.has('inviteUserToTeam')).toBe(true);
  });

  it('reads through an injected CatalogSource (the swap seam)', () => {
    const fakeSource: CatalogSource = {
      load(): RawManagementCatalog {
        return {
          operations: {
            keepMe: {
              name: 'keepMe',
              kind: 'query',
              description: 'visible',
              rootFields: ['keepMe'],
              returnTypes: ['Thing'],
              document: 'query keepMe { keepMe }',
              fragmentNames: [],
              variables: [],
            },
            hideMe: {
              name: 'hideMe',
              kind: 'mutation',
              description: 'flagged',
              featureFlagGated: true,
              rootFields: ['hideMe'],
              returnTypes: ['Thing'],
              document: 'mutation hideMe { hideMe }',
              fragmentNames: [],
              variables: [],
            },
          },
          fragments: {},
          inputTypes: {},
        };
      },
    };

    const filtered = loadManagementCatalog(fakeSource);
    expect(filtered.operations.map((op) => op.name)).toEqual(['keepMe']);

    const all = loadManagementCatalog(fakeSource, { includeFeatureFlagged: true });
    expect(all.operations.map((op) => op.name).sort()).toEqual(['hideMe', 'keepMe']);
  });
});

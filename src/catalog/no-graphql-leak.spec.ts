import { describe, it, expect } from 'vitest';
import { loadManagementCatalog } from './loader.js';
import { getManifest } from './manifest.js';
import { OVERRIDES, resolveCommandMeta, findLeaks, LEAK_PATTERN } from './curation.js';
import { dashboardErrorMessage } from './operation.js';
import { DASHBOARD_ERROR_MESSAGES } from '../lib/command-auth.js';
import { DashboardGraphqlError, type DashboardGraphqlErrorCode } from '../lib/dashboard-graphql.js';
import type { CatalogOperation } from './catalog-types.js';

const catalog = loadManagementCatalog(undefined, { includeFeatureFlagged: true });
const byName = new Map(catalog.operations.map((op) => [op.name, op]));

function op(name: string): CatalogOperation {
  const found = byName.get(name);
  if (!found) throw new Error(`Test fixture op "${name}" not found in catalog`);
  return found;
}

describe('no GraphQL/userland leak in curated command metadata', () => {
  it('every manifest entry resolves to clean command metadata', () => {
    // Forward guard: when commands land in the manifest (Phase 3+), each one's
    // resolved metadata must be free of internal naming.
    for (const entry of getManifest()) {
      const opForEntry = byName.get(entry.mapsTo);
      expect(opForEntry, `manifest op "${entry.mapsTo}" missing from catalog`).toBeDefined();
      const meta = resolveCommandMeta(opForEntry!);
      expect(findLeaks(meta), `${entry.mapsTo} -> ${JSON.stringify(meta)}`).toEqual([]);
      // The clean command noun is the one the manifest records.
      expect(meta.command).toBe(entry.command);
    }
  });

  it('every override entry resolves to clean metadata', () => {
    for (const name of Object.keys(OVERRIDES)) {
      const meta = resolveCommandMeta(op(name));
      expect(findLeaks(meta), `${name} -> ${JSON.stringify(meta)}`).toEqual([]);
    }
  });

  it('resolves a userland-named op (userlandUsers) to a clean noun', () => {
    // The op NAME leaks ("userland") even though its description is clean.
    const raw = op('userlandUsers');
    expect(LEAK_PATTERN.test(raw.name)).toBe(true);

    const meta = resolveCommandMeta(raw);
    expect(meta.command).toBe('user list');
    expect(findLeaks(meta)).toEqual([]);
  });

  it('overrides a rotten description (teamProjectsV2)', () => {
    // The catalog description is wrong upstream: it claims to "Return the team
    // for the current dashboard session" when the op lists projects.
    const raw = op('teamProjectsV2');
    expect(raw.description).toMatch(/return the team for the current dashboard session/i);

    const meta = resolveCommandMeta(raw);
    expect(meta.command).toBe('project list');
    expect(meta.describe).toBe('List projects in the current team');
    expect(findLeaks(meta)).toEqual([]);
  });

  it('findLeaks flags both fields when metadata leaks', () => {
    expect(findLeaks({ command: 'user list', describe: 'List users' })).toEqual([]);
    expect(findLeaks({ command: 'userland list', describe: 'clean' })).toEqual(['command']);
    expect(findLeaks({ command: 'clean', describe: 'a graphql thing' })).toEqual(['describe']);
    expect(findLeaks({ command: 'userland', describe: 'graphql' })).toEqual(['command', 'describe']);
  });
});

describe('no GraphQL/userland leak in dashboard-plane error copy', () => {
  it('every DASHBOARD_ERROR_MESSAGES constant is a clean, non-empty string', () => {
    const entries = Object.entries(DASHBOARD_ERROR_MESSAGES);
    // Getter-backed object: emptying it (or breaking a getter) must fail loudly.
    expect(entries.length).toBeGreaterThanOrEqual(4);
    for (const [key, message] of entries) {
      expect(typeof message, key).toBe('string');
      expect(message.length, key).toBeGreaterThan(0);
      expect(LEAK_PATTERN.test(message), `${key}: ${message}`).toBe(false);
    }
  });

  it('dashboardErrorMessage copy is clean for every error code', () => {
    const codes: DashboardGraphqlErrorCode[] = ['forbidden', 'http_error', 'graphql_error', 'network_error'];
    for (const code of codes) {
      // The client's own message ALWAYS leaks ("dashboard GraphQL API") — the
      // user-facing translation must never echo it.
      const message = dashboardErrorMessage(
        new DashboardGraphqlError('The dashboard GraphQL API rejected this session (HTTP 403).', code, 403),
      );
      expect(message.length, code).toBeGreaterThan(0);
      expect(LEAK_PATTERN.test(message), `${code}: ${message}`).toBe(false);
    }
  });

  it('forbidden copy no longer claims the capability is staging-gated', () => {
    expect(DASHBOARD_ERROR_MESSAGES.forbidden).not.toMatch(/staging/i);
    expect(
      dashboardErrorMessage(new DashboardGraphqlError('x', 'forbidden', 403)),
    ).toBe(DASHBOARD_ERROR_MESSAGES.forbidden);
  });
});

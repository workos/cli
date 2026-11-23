import { describe, it, expect } from 'vitest';
import { loadManagementCatalog } from './loader.js';
import { getManifest } from './manifest.js';
import { OVERRIDES, resolveCommandMeta, findLeaks, LEAK_PATTERN } from './curation.js';
import { dashboardErrorMessage, getOperation, resolveExecutableDocument } from './operation.js';
import { DASHBOARD_ERROR_MESSAGES } from '../lib/command-auth.js';
import { DashboardGraphqlError, type DashboardGraphqlErrorCode } from '../lib/dashboard-graphql.js';
import { buildCommandTree, type CommandSchema, type HelpOutput } from '../utils/help-json.js';
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

describe('no GraphQL/userland leak in the help-json registry for migrated commands', () => {
  // Data-driven off the manifest: every top-level noun that has at least one
  // catalog-backed command gets its full help-json subtree scanned, so later
  // migration phases inherit this coverage automatically by adding manifest
  // entries — no per-phase test edits.
  const migratedNouns = [...new Set(getManifest().map((entry) => entry.command.split(' ')[0]))];
  const tree = buildCommandTree() as HelpOutput;

  /** Every user-visible string in a registry subtree (names, descriptions, examples). */
  function collectStrings(schema: CommandSchema): string[] {
    const strings = [schema.name, schema.description];
    for (const option of schema.options ?? []) strings.push(option.name, option.description);
    for (const positional of schema.positionals ?? []) strings.push(positional.name, positional.description);
    for (const example of schema.examples ?? []) strings.push(example);
    for (const child of schema.commands ?? []) strings.push(...collectStrings(child));
    return strings;
  }

  it('covers at least the Phase-3 migrated nouns', () => {
    expect(migratedNouns).toEqual(expect.arrayContaining(['organization', 'user']));
  });

  it.each(migratedNouns)('help-json subtree for "%s" is leak-free', (noun) => {
    const entry = tree.commands.find((command) => command.name === noun);
    expect(entry, `help-json registry entry for "${noun}" is missing`).toBeDefined();
    for (const value of collectStrings(entry!)) {
      expect(LEAK_PATTERN.test(value), `${noun}: "${value}"`).toBe(false);
    }
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

  it('appends a clean server error code to graphql_error copy, never the server message', () => {
    const msg = (serverCode?: string) =>
      dashboardErrorMessage(new DashboardGraphqlError('private details', 'graphql_error', undefined, serverCode));
    expect(msg('INTERNAL_SERVER_ERROR')).toBe(
      'The WorkOS account plane could not complete this request (INTERNAL_SERVER_ERROR).',
    );
    expect(msg('GRAPHQL_VALIDATION_FAILED')).toContain('(VALIDATION_FAILED)');
    expect(msg(undefined)).toBe('The WorkOS account plane could not complete this request.');
    expect(msg('not a code; private')).toBe('The WorkOS account plane could not complete this request.');
    expect(msg('USERLAND_THING')).toBe('The WorkOS account plane could not complete this request.');
    expect(msg('INTERNAL_SERVER_ERROR')).not.toContain('private details');
  });

  it('forbidden copy no longer claims the capability is staging-gated', () => {
    expect(DASHBOARD_ERROR_MESSAGES.forbidden).not.toMatch(/staging/i);
    expect(dashboardErrorMessage(new DashboardGraphqlError('x', 'forbidden', 403))).toBe(
      DASHBOARD_ERROR_MESSAGES.forbidden,
    );
  });
});

// Only the selection syntax used by this query and its fragments is needed.
// Reject arguments and directives rather than mistaking their names for fields.
function selectedFieldPaths(document: string, fragments: Record<string, string> = {}): Set<string> {
  const paths = new Set<string>();
  const activeFragments = new Set<string>();

  function visitDefinition(source: string, prefix: string) {
    const tokens = source.replace(/#[^\r\n]*/g, '').match(/\.\.\.|[_A-Za-z][_0-9A-Za-z]*|[^\s,]/g) ?? [];
    let index = 0;

    function consume(expected: string) {
      const token = tokens[index++];
      if (token !== expected) throw new Error(`Expected "${expected}", got ${token ?? 'end of document'}`);
    }

    function readName(): string {
      const token = tokens[index++];
      if (!token || !/^[_A-Za-z]/.test(token)) throw new Error(`Expected a name, got ${token ?? 'end of document'}`);
      return token;
    }

    function visitSelection(parent: string) {
      consume('{');
      while (tokens[index] !== '}') {
        if (tokens[index] === '...') {
          index++;
          const name = readName();
          if (name === 'on') {
            readName(); // Inline fragment type condition, not a field.
            visitSelection(parent);
          } else {
            const fragment = fragments[name];
            if (typeof fragment !== 'string') throw new Error(`Missing fragment "${name}"`);
            if (activeFragments.has(name)) throw new Error(`Cyclic fragment "${name}"`);
            activeFragments.add(name);
            visitDefinition(fragment, parent);
            activeFragments.delete(name);
          }
          continue;
        }
        let field = readName();
        if (tokens[index] === ':') {
          index++;
          field = readName(); // Use the schema field name, not the alias.
        }
        const path = parent ? `${parent}.${field}` : field;
        paths.add(path);
        if (tokens[index] === '{') visitSelection(path);
      }
      consume('}');
    }

    if (tokens[index] === 'fragment') {
      consume('fragment');
      readName();
      consume('on');
      readName();
    } else {
      consume('query');
      readName();
    }
    visitSelection(prefix);
    if (index !== tokens.length) throw new Error(`Unexpected token "${tokens[index]}" after selection set`);
  }

  visitDefinition(document, '');
  return paths;
}

describe('teamProjectsV2 wire document', () => {
  // Every env-scoped command resolves its target through this query, so it must
  // select only what the CLI reads: a failing resolver on an unread field
  // (e.g. certificate expiry) must not take down every command for the team.
  it('selects only the fields the CLI reads', () => {
    const doc = resolveExecutableDocument(getOperation('teamProjectsV2'));
    expect(doc).toContain('query teamProjectsV2');
    for (const field of ['projectsV2', 'clientId', 'sandbox']) expect(doc).toContain(field);
    for (const field of ['...Environment', 'expiredConnectionCertificates', 'customAuthDomain', 'resourceTypeCount']) {
      expect(doc).not.toContain(field);
    }
  });

  // `catalog:vendor` never refreshes the override. Compare paths, not names:
  // a project may still select `name` after the environment field is renamed.
  it('selects only fields the vendored catalog also selects', () => {
    const operation = getOperation('teamProjectsV2');
    const fragments = Object.fromEntries(operation.fragmentNames.map((name) => [name, catalog.fragments[name]]));
    const vendoredPaths = selectedFieldPaths(operation.document, fragments);
    const overridePaths = selectedFieldPaths(resolveExecutableDocument(operation));
    const drift = [...overridePaths].filter((path) => !vendoredPaths.has(path));
    expect(drift).toEqual([]);
  });
});

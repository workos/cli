import { describe, it, expect } from 'vitest';
import { validateManifest } from './justification.js';
import type { CommandJustification } from './manifest-types.js';
import type { ManagementCatalog } from './catalog-types.js';

function makeCatalog(opNames: string[]): ManagementCatalog {
  return {
    operations: opNames.map((name) => ({
      name,
      kind: 'mutation' as const,
      description: `desc for ${name}`,
      rootFields: [name],
      returnTypes: ['Thing'],
      document: `mutation ${name} { ${name} }`,
      fragmentNames: [],
      variables: [],
    })),
    fragments: {},
    inputTypes: {},
  };
}

const catalog = makeCatalog(['inviteUserToTeam', 'createEnvironment']);

function validEntry(overrides: Partial<CommandJustification> = {}): CommandJustification {
  return {
    command: 'team invite',
    mapsTo: 'inviteUserToTeam',
    audiences: ['human', 'agent'],
    useCase: 'Invite a teammate without leaving the terminal',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'require-flag',
    ...overrides,
  };
}

describe('validateManifest', () => {
  it('passes an empty manifest', () => {
    const result = validateManifest([], catalog);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('passes a fully valid entry', () => {
    const result = validateManifest([validEntry()], catalog);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a missing useCase', () => {
    const result = validateManifest([validEntry({ useCase: '' })], catalog);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /useCase/.test(e))).toBe(true);
  });

  it('rejects a whitespace-only useCase', () => {
    const result = validateManifest([validEntry({ useCase: '   ' })], catalog);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /useCase/.test(e))).toBe(true);
  });

  it('rejects a mapsTo not present in the catalog', () => {
    const result = validateManifest([validEntry({ mapsTo: 'noSuchOperation' })], catalog);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /not an operation in the catalog/.test(e))).toBe(true);
  });

  it('rejects empty audiences', () => {
    const result = validateManifest([validEntry({ audiences: [] })], catalog);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /audiences/.test(e))).toBe(true);
  });

  it('rejects an out-of-enum load', () => {
    const result = validateManifest([validEntry({ load: 'gigantic' as CommandJustification['load'] })], catalog);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /"load"/.test(e))).toBe(true);
  });

  it('rejects an out-of-enum ciPolicy', () => {
    const result = validateManifest(
      [validEntry({ ciPolicy: 'whenever' as CommandJustification['ciPolicy'] })],
      catalog,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /"ciPolicy"/.test(e))).toBe(true);
  });

  it('rejects an invalid audience value', () => {
    const result = validateManifest(
      [validEntry({ audiences: ['robot' as CommandJustification['audiences'][number]] })],
      catalog,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /invalid audience/.test(e))).toBe(true);
  });

  it('reports all errors across multiple entries', () => {
    const result = validateManifest(
      [validEntry({ command: 'a', useCase: '' }), validEntry({ command: 'b', mapsTo: 'nope' })],
      catalog,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /"a".*useCase/.test(e))).toBe(true);
    expect(result.errors.some((e) => /"b".*not an operation/.test(e))).toBe(true);
  });

  it('labels a malformed entry by index when command is absent', () => {
    const broken = { mapsTo: 'inviteUserToTeam' } as unknown as CommandJustification;
    const result = validateManifest([broken], catalog);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /#0/.test(e))).toBe(true);
  });
});

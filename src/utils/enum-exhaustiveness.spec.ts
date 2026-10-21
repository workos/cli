import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { enumOut } from './output-conventions.js';

/**
 * Exhaustiveness harness for the enum-normalization boundary.
 *
 * `enumOut` is the single translation point between the backend's GraphQL enum
 * vocabulary and the CLI's `--json` contract. This test loads the vendored
 * schema snapshot and drives EVERY enum value the backend can emit through the
 * normalizer, so a change to the normalizer that would make CLI output
 * ambiguous, non-round-trippable, or off-contract fails here rather than in a
 * user's script.
 */

interface DiscoveredEnum {
  typeName: string;
  values: string[];
}

/**
 * Walk the snapshot for every `{ kind: 'ENUM', name, enumValues }` node.
 *
 * `enumValues` entries are strings in this snapshot; we also accept the
 * `{ name }` object form so the test survives a snapshot format change instead
 * of silently reading zero values. The same enum type can appear more than once
 * (input vs output positions); we keep the last occurrence, which is fine since
 * a type's value set is identical wherever it appears.
 */
function discoverEnums(root: unknown): DiscoveredEnum[] {
  const found = new Map<string, string[]>();

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (node === null || typeof node !== 'object') return;

    const record = node as Record<string, unknown>;
    if (record.kind === 'ENUM' && typeof record.name === 'string' && Array.isArray(record.enumValues)) {
      const values = record.enumValues
        .map((entry) => {
          if (typeof entry === 'string') return entry;
          if (entry !== null && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string') {
            return (entry as { name: string }).name;
          }
          return undefined;
        })
        .filter((v): v is string => typeof v === 'string');
      found.set(record.name, values);
    }

    for (const key of Object.keys(record)) walk(record[key]);
  };

  walk(root);
  return [...found].map(([typeName, values]) => ({ typeName, values }));
}

const snapshotPath = fileURLToPath(new URL('../catalog/mcp-catalog.snapshot.json', import.meta.url));
const snapshot: unknown = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const enums = discoverEnums(snapshot);

describe('enum catalog discovery', () => {
  it('finds the enum types by walking the snapshot structure', () => {
    // A future refactor that moves or reshapes the catalog must not let this
    // suite pass vacuously on zero enums.
    expect(Array.isArray(enums)).toBe(true);
    expect(enums.length).toBeGreaterThan(50);
  });

  it('reads a non-empty value list for every discovered enum', () => {
    const empty = enums.filter((e) => e.values.length === 0);
    expect(empty.map((e) => e.typeName)).toEqual([]);
  });
});

describe('enumOut across every catalog enum', () => {
  it('never produces a collision within a single enum type', () => {
    const collisions: string[] = [];
    for (const { typeName, values } of enums) {
      const byOutput = new Map<string, string>();
      for (const value of values) {
        const out = enumOut(value);
        if (out === null) continue;
        const prior = byOutput.get(out);
        if (prior !== undefined && prior !== value) {
          collisions.push(`${typeName}: "${prior}" and "${value}" both normalize to "${out}"`);
        } else {
          byOutput.set(out, value);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it('is idempotent for every value', () => {
    const failures: string[] = [];
    for (const { typeName, values } of enums) {
      for (const value of values) {
        const once = enumOut(value);
        if (once === null) continue;
        const twice = enumOut(once);
        if (twice !== once) {
          failures.push(`${typeName}: enumOut("${value}")="${once}" but enumOut("${once}")="${twice}"`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('never returns null or empty for a real enum value', () => {
    const empties: string[] = [];
    for (const { typeName, values } of enums) {
      for (const value of values) {
        const out = enumOut(value);
        if (out === null || out === '') empties.push(`${typeName}: "${value}" -> ${JSON.stringify(out)}`);
      }
    }
    expect(empties).toEqual([]);
  });

  it('never leaks an uppercase letter', () => {
    const leaks: string[] = [];
    for (const { typeName, values } of enums) {
      for (const value of values) {
        const out = enumOut(value);
        if (out !== null && /[A-Z]/.test(out)) leaks.push(`${typeName}: "${value}" -> "${out}"`);
      }
    }
    expect(leaks).toEqual([]);
  });
});

describe('enumOut surprising-normalization report', () => {
  it('flags no NEW odd digit/case-boundary value beyond the reviewed allowlist', () => {
    // Informational guard, not a correctness claim. Values where a digit sits
    // against a case boundary (a digit immediately followed by an uppercase
    // letter) normalize in an arguably-wrong way, e.g. "M2M" -> "m2_m". We pin
    // the current set so a NEW such value fails here and forces a human to
    // decide whether the normalizer needs a special case, rather than shipping
    // a surprising output silently. Derived empirically from the snapshot.
    const KNOWN_ODD: Record<string, string> = {
      Auth0Migration: 'auth0_migration',
      Auth0SAML: 'auth0_saml',
      M2M: 'm2_m',
      US1FED: 'us1_fed',
      X509CertificateExpired: 'x509_certificate_expired',
      X509CertificateExpiring: 'x509_certificate_expiring',
    };

    const odd: Record<string, string> = {};
    for (const { values } of enums) {
      for (const value of values) {
        if (/[0-9][A-Z]/.test(value)) {
          const out = enumOut(value);
          if (out !== null) odd[value] = out;
        }
      }
    }

    expect(odd).toEqual(KNOWN_ODD);
  });
});

describe('shipped enum output contract', () => {
  it('pins the enum values the migrated commands emit today', () => {
    // These are the values the migrated commands actually print. If the
    // normalizer changes their output, the shipped `--json` contract breaks and
    // this fails loudly.
    const expected: Record<string, string> = {
      Active: 'active',
      Verified: 'verified',
      Pending: 'pending',
      Environment: 'environment',
      Organization: 'organization',
      Standard: 'standard',
      Dns: 'dns',
      Manual: 'manual',
    };
    for (const [input, output] of Object.entries(expected)) {
      expect(enumOut(input)).toBe(output);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { resolveCanonicalName, resolveCommandNameFromRawArgs, extractUserFlags } from './command-telemetry.js';

describe('command-telemetry', () => {
  describe('resolveCanonicalName', () => {
    it('resolves aliased commands', () => {
      expect(resolveCanonicalName(['org', 'list'])).toBe('organization.list');
    });

    it('passes through non-aliased commands', () => {
      expect(resolveCanonicalName(['auth', 'login'])).toBe('auth.login');
    });

    it('returns root for empty parts', () => {
      expect(resolveCanonicalName([])).toBe('root');
    });

    it('handles single-part commands', () => {
      expect(resolveCanonicalName(['install'])).toBe('install');
    });

    it('only aliases the first part', () => {
      expect(resolveCanonicalName(['org', 'org'])).toBe('organization.org');
    });
  });

  describe('resolveCommandNameFromRawArgs', () => {
    it('resolves the top-level command (used when validation fails before middleware runs)', () => {
      expect(resolveCommandNameFromRawArgs(['organization', 'create'])).toBe('organization');
    });

    it('applies aliases to the top-level token', () => {
      expect(resolveCommandNameFromRawArgs(['org', 'create'])).toBe('organization');
    });

    it('records only the top-level command, never positional values (no PII/secret leak)', () => {
      // `onboard-user <email>` takes a positional value; it must not reach command.name.
      expect(resolveCommandNameFromRawArgs(['onboard-user', 'nick@example.com'])).toBe('onboard-user');
    });

    it('returns root when there is no command token', () => {
      expect(resolveCommandNameFromRawArgs([])).toBe('root');
      expect(resolveCommandNameFromRawArgs(['--json'])).toBe('root');
    });

    it('skips leading flags to find the command token', () => {
      expect(resolveCommandNameFromRawArgs(['--json', 'user', 'get'])).toBe('user');
    });

    it('returns root for unknown commands (does not emit typos as command names)', () => {
      expect(resolveCommandNameFromRawArgs(['bogus'])).toBe('root');
    });

    it('never records an option value as the command name (--mode <value>)', () => {
      // Without whitelisting, the first non-flag token would be `ci`.
      expect(resolveCommandNameFromRawArgs(['--mode', 'ci', 'organization', 'create'])).toBe('organization');
    });

    it('never records a secret option value as the command name (--api-key <secret>)', () => {
      // Regression: a value-taking option before the command must not leak the
      // secret into command.name (which is then sent to the telemetry backend).
      expect(resolveCommandNameFromRawArgs(['--api-key', 'sk_live_SECRET', 'organization', 'create'])).toBe(
        'organization',
      );
    });
  });

  describe('extractUserFlags', () => {
    it('extracts long flags', () => {
      expect(extractUserFlags(['org', 'list', '--json'])).toEqual(['json']);
    });

    it('extracts short flags', () => {
      expect(extractUserFlags(['-v'])).toEqual(['v']);
    });

    it('handles flags with values', () => {
      expect(extractUserFlags(['--env=staging'])).toEqual(['env']);
    });

    it('deduplicates flags', () => {
      expect(extractUserFlags(['--json', '--json'])).toEqual(['json']);
    });

    it('ignores positionals', () => {
      expect(extractUserFlags(['org', 'list', 'my-org'])).toEqual([]);
    });

    it('ignores multi-char short flags (not real flags)', () => {
      expect(extractUserFlags(['-abc'])).toEqual([]);
    });

    it('ignores the positional separator `--`', () => {
      expect(extractUserFlags(['org', 'list', '--', 'extra'])).toEqual([]);
    });

    it('ignores negative number values, not flags', () => {
      expect(extractUserFlags(['--limit', '-1'])).toEqual(['limit']);
    });
  });
});

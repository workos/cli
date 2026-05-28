import { describe, it, expect } from 'vitest';
import { resolveCanonicalName, extractUserFlags } from './command-telemetry.js';

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
  });
});

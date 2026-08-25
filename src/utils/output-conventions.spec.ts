import { describe, it, expect } from 'vitest';
import { enumOut, enumIn, metadataToMap } from './output-conventions.js';

describe('enumOut', () => {
  it('lowercases backend casings', () => {
    expect(enumOut('Verified')).toBe('verified');
    expect(enumOut('PENDING')).toBe('pending');
    expect(enumOut('Active')).toBe('active');
  });

  it('snake_cases multiword values instead of running them together', () => {
    expect(enumOut('UserRegistration')).toBe('user_registration');
    expect(enumOut('GenericHttps')).toBe('generic_https');
    expect(enumOut('AdpOidc')).toBe('adp_oidc');
    expect(enumOut('GoogleCloudStorage')).toBe('google_cloud_storage');
  });

  it('keeps acronym runs as one token, having no reliable way to split them', () => {
    expect(enumOut('SOME')).toBe('some');
    expect(enumOut('ADFSSAML')).toBe('adfssaml');
  });

  it('is idempotent, so converted output survives a second pass', () => {
    for (const v of ['Active', 'UserRegistration', 'SOME', 'GenericHttps']) {
      const once = enumOut(v)!;
      expect(enumOut(once)).toBe(once);
    }
  });

  it('is a no-op for every value the migrated commands emit today', () => {
    // Observed against the live API. If one of these ever changes, the parity
    // harness and the JSON snapshots should both fail before users notice.
    const emitted = ['Active', 'Verified', 'Pending', 'Environment', 'Organization', 'Standard', 'Dns', 'Manual'];
    for (const v of emitted) {
      expect(enumOut(v)).toBe(v.toLowerCase());
      expect(enumOut(v)).not.toContain('_');
    }
  });

  it('passes through values already in convention', () => {
    expect(enumOut('active')).toBe('active');
  });

  it('collapses absent and blank to null', () => {
    expect(enumOut(null)).toBeNull();
    expect(enumOut(undefined)).toBeNull();
    expect(enumOut('')).toBeNull();
  });
});

describe('enumIn', () => {
  it('accepts any casing the CLI might have printed', () => {
    expect(enumIn('Verified')).toBe('verified');
    expect(enumIn('verified')).toBe('verified');
  });

  it('round-trips whatever enumOut produced', () => {
    for (const backend of ['Verified', 'PENDING', 'Active']) {
      const printed = enumOut(backend);
      expect(enumIn(printed)).toBe(printed);
    }
  });

  it('leaves absent input absent so callers can apply their own default', () => {
    expect(enumIn(null)).toBeUndefined();
    expect(enumIn(undefined)).toBeUndefined();
  });
});

describe('metadataToMap', () => {
  it('folds the GraphQL array-of-pairs into a map so .metadata.foo resolves', () => {
    expect(metadataToMap([{ key: 'team', value: 'blue' }])).toEqual({ team: 'blue' });
  });

  it('handles multiple pairs', () => {
    expect(
      metadataToMap([
        { key: 'team', value: 'blue' },
        { key: 'tier', value: 'gold' },
      ]),
    ).toEqual({ team: 'blue', tier: 'gold' });
  });

  it('returns an empty map for absent metadata, never null', () => {
    expect(metadataToMap(null)).toEqual({});
    expect(metadataToMap(undefined)).toEqual({});
    expect(metadataToMap([])).toEqual({});
  });

  it('passes an existing map through unchanged', () => {
    expect(metadataToMap({ team: 'blue' })).toEqual({ team: 'blue' });
  });

  it('resolves duplicate keys last-wins', () => {
    expect(
      metadataToMap([
        { key: 'team', value: 'blue' },
        { key: 'team', value: 'red' },
      ]),
    ).toEqual({ team: 'red' });
  });

  it('skips malformed pairs rather than emitting an empty key', () => {
    const input = [
      { key: '', value: 'x' },
      { key: 'ok', value: 'y' },
    ] as Array<{ key: string; value: string }>;
    expect(metadataToMap(input)).toEqual({ ok: 'y' });
  });
});

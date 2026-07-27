import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { checkDashboardSettings, isCredentialSafeBaseUrl } = await import('./dashboard.js');

import type { DoctorOptions, EnvironmentRaw } from '../types.js';

const options: DoctorOptions = { installDir: '/tmp/project', skipApi: false };

function raw(overrides: Partial<EnvironmentRaw> = {}): EnvironmentRaw {
  return { apiKey: 'sk_test_abc', clientId: null, baseUrl: 'https://api.workos.com', ...overrides };
}

describe('isCredentialSafeBaseUrl', () => {
  it('allows the default WorkOS API host', () => {
    expect(isCredentialSafeBaseUrl('https://api.workos.com')).toBe(true);
  });

  it('allows any HTTPS *.workos.com subdomain', () => {
    expect(isCredentialSafeBaseUrl('https://api.workos.com/')).toBe(true);
    expect(isCredentialSafeBaseUrl('https://auth.workos.com')).toBe(true);
    expect(isCredentialSafeBaseUrl('https://workos.com')).toBe(true);
  });

  it('allows a trusted host with a trailing root-label dot', () => {
    expect(isCredentialSafeBaseUrl('https://api.workos.com.')).toBe(true);
    expect(isCredentialSafeBaseUrl('https://api.workos.com.attacker.example.')).toBe(false);
  });

  it('allows localhost for internal development over any scheme', () => {
    expect(isCredentialSafeBaseUrl('http://localhost:8001')).toBe(true);
    expect(isCredentialSafeBaseUrl('http://127.0.0.1:3000')).toBe(true);
  });

  it('rejects non-WorkOS hosts', () => {
    expect(isCredentialSafeBaseUrl('https://workos-diag.attacker.example')).toBe(false);
    expect(isCredentialSafeBaseUrl('https://evil.example')).toBe(false);
  });

  it('rejects look-alike hosts that only suffix-match the string', () => {
    expect(isCredentialSafeBaseUrl('https://api.workos.com.attacker.example')).toBe(false);
    expect(isCredentialSafeBaseUrl('https://notworkos.com')).toBe(false);
  });

  it('rejects non-HTTPS remote hosts', () => {
    expect(isCredentialSafeBaseUrl('http://api.workos.com')).toBe(false);
  });

  it('rejects unparsable values', () => {
    expect(isCredentialSafeBaseUrl('not a url')).toBe(false);
    expect(isCredentialSafeBaseUrl('')).toBe(false);
  });
});

describe('checkDashboardSettings base URL guard', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('does not send the credential to an attacker-controlled base URL', async () => {
    const result = await checkDashboardSettings(
      options,
      'staging',
      raw({ baseUrl: 'https://workos-diag.attacker.example' }),
    );

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.settings).toBeNull();
    expect(result.error).toContain('untrusted');
  });

  it('proceeds for a trusted WorkOS base URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ list_metadata: { total_count: 0 } }),
    } as Response);

    await checkDashboardSettings(options, 'staging', raw());

    expect(mockFetch).toHaveBeenCalled();
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl.startsWith('https://api.workos.com/')).toBe(true);
  });

  it('still skips production keys before any URL handling', async () => {
    const result = await checkDashboardSettings(options, 'production', raw());
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.error).toContain('production');
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock logging
vi.mock('../utils/logging.js', () => ({
  yellow: vi.fn(),
  dim: vi.fn(),
}));

// Mock settings
vi.mock('./settings.js', () => ({
  getVersion: vi.fn(() => '0.3.0'),
}));

// Pin the upgrade line so the assertion below doesn't depend on the ambient
// execPath of whatever runs the tests (which may itself live under Homebrew's
// Cellar or a node_modules dir). detectInstallMethod is exercised directly in
// install-method.spec.ts.
vi.mock('./install-method.js', () => ({
  upgradeNotice: vi.fn(() => 'Download: https://github.com/workos/cli/releases/latest'),
}));

const { checkForUpdates, _resetWarningState } = await import('./version-check.js');
const { yellow, dim } = await import('../utils/logging.js');

// github.com/…/releases/latest answers with a redirect to the tag page.
function redirectTo(tag: string) {
  return {
    status: 302,
    headers: new Headers({ location: `https://github.com/workos/cli/releases/tag/${tag}` }),
  };
}

describe('version-check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetWarningState();
  });

  it('shows warning when outdated', async () => {
    mockFetch.mockResolvedValueOnce(redirectTo('v0.4.0'));

    await checkForUpdates();

    expect(yellow).toHaveBeenCalledWith(expect.stringContaining('0.3.0 → 0.4.0'));
    expect(dim).toHaveBeenCalledWith('Download: https://github.com/workos/cli/releases/latest');
  });

  it('no warning when up to date', async () => {
    mockFetch.mockResolvedValueOnce(redirectTo('v0.3.0'));

    await checkForUpdates();

    expect(yellow).not.toHaveBeenCalled();
  });

  it('no warning when ahead of the latest release', async () => {
    mockFetch.mockResolvedValueOnce(redirectTo('v0.2.0'));

    await checkForUpdates();

    expect(yellow).not.toHaveBeenCalled();
  });

  it('silently handles fetch error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(checkForUpdates()).resolves.toBeUndefined();
    expect(yellow).not.toHaveBeenCalled();
  });

  it('silently handles timeout', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

    await expect(checkForUpdates()).resolves.toBeUndefined();
    expect(yellow).not.toHaveBeenCalled();
  });

  it('silently handles a non-redirect response', async () => {
    mockFetch.mockResolvedValueOnce({ status: 200, headers: new Headers() });

    await expect(checkForUpdates()).resolves.toBeUndefined();
    expect(yellow).not.toHaveBeenCalled();
  });

  it('silently handles a redirect to an unexpected location', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: 'https://github.com/workos/cli/releases' }),
    });

    await expect(checkForUpdates()).resolves.toBeUndefined();
    expect(yellow).not.toHaveBeenCalled();
  });

  it('silently handles invalid semver', async () => {
    mockFetch.mockResolvedValueOnce(redirectTo('not-valid-semver'));

    await expect(checkForUpdates()).resolves.toBeUndefined();
    expect(yellow).not.toHaveBeenCalled();
  });

  it('only warns once', async () => {
    mockFetch.mockResolvedValue(redirectTo('v0.4.0'));

    await checkForUpdates();
    await checkForUpdates();

    expect(yellow).toHaveBeenCalledTimes(1);
  });
});

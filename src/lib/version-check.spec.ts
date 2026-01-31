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

const { checkForUpdates, _resetWarningState } = await import('./version-check.js');
const { yellow, dim } = await import('../utils/logging.js');

describe('version-check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetWarningState();
  });

  it('shows warning when outdated', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: '0.4.0' }),
    });

    await checkForUpdates();

    expect(yellow).toHaveBeenCalledWith(expect.stringContaining('0.3.0 → 0.4.0'));
    expect(dim).toHaveBeenCalledWith('Run: npx workos@latest');
  });

  it('no warning when up to date', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: '0.3.0' }),
    });

    await checkForUpdates();

    expect(yellow).not.toHaveBeenCalled();
  });

  it('no warning when ahead of npm', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: '0.2.0' }),
    });

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

  it('silently handles non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });

    await expect(checkForUpdates()).resolves.toBeUndefined();
    expect(yellow).not.toHaveBeenCalled();
  });

  it('silently handles invalid JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error('Invalid JSON');
      },
    });

    await expect(checkForUpdates()).resolves.toBeUndefined();
    expect(yellow).not.toHaveBeenCalled();
  });

  it('silently handles invalid semver', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: 'not-valid-semver' }),
    });

    await expect(checkForUpdates()).resolves.toBeUndefined();
    expect(yellow).not.toHaveBeenCalled();
  });

  it('only warns once', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.4.0' }),
    });

    await checkForUpdates();
    await checkForUpdates();

    expect(yellow).toHaveBeenCalledTimes(1);
  });
});

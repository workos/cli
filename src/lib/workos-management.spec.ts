import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCapture = vi.fn();
vi.mock('../utils/analytics.js', () => ({
  analytics: { capture: (...args: unknown[]) => mockCapture(...args) },
}));

const mockSelect = vi.fn();
const mockPassword = vi.fn();
const mockUi = {
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    step: vi.fn(),
    success: vi.fn(),
    hint: vi.fn(),
    detail: vi.fn(),
  },
  rows: vi.fn(),
  select: (...args: unknown[]) => mockSelect(...args),
  password: (...args: unknown[]) => mockPassword(...args),
};
vi.mock('../utils/ui.js', () => ({
  default: mockUi,
  isCancel: (v: unknown) => typeof v === 'symbol',
  isDashboardMode: () => false,
}));

const mockIsPromptAllowed = vi.fn(() => false);
vi.mock('../utils/interaction-mode.js', () => ({
  isPromptAllowed: () => mockIsPromptAllowed(),
}));

vi.mock('./port-detection.js', () => ({
  getCallbackPath: () => '/callback',
}));

// Mocks for the re-auth path's dynamic imports
const mockEnsureAuthenticated = vi.fn();
vi.mock('./ensure-auth.js', () => ({
  ensureAuthenticated: () => mockEnsureAuthenticated(),
}));
const mockGetAccessToken = vi.fn();
const mockSaveStagingCredentials = vi.fn();
vi.mock('./credentials.js', () => ({
  getAccessToken: () => mockGetAccessToken(),
  saveStagingCredentials: (...args: unknown[]) => mockSaveStagingCredentials(...args),
}));
const mockFetchStagingCredentials = vi.fn();
vi.mock('./staging-api.js', () => ({
  fetchStagingCredentials: (...args: unknown[]) => mockFetchStagingCredentials(...args),
}));

const { autoConfigureWorkOSEnvironment, promptForUnauthorizedRecovery, DashboardConfigError } = await import(
  './workos-management.js'
);

function mockResponse(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const OK = () => mockResponse(200, {});
const UNAUTHORIZED = () => mockResponse(401, { message: 'Unauthorized' });

describe('workos-management', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPromptAllowed.mockReturnValue(false);
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('autoConfigureWorkOSEnvironment', () => {
    it('returns the config results and original API key on success', async () => {
      mockFetch.mockResolvedValue(OK());

      const outcome = await autoConfigureWorkOSEnvironment('sk_test_123', 'nextjs', 3000);

      expect(outcome).not.toBeNull();
      expect(outcome!.apiKey).toBe('sk_test_123');
      // No recovery happened, so no replacement clientId is surfaced
      expect(outcome!.clientId).toBeUndefined();
      expect(outcome!.results.homepageUrl).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockUi.log.success).toHaveBeenCalledWith('WorkOS dashboard configured');
    });

    it('treats 409/422 already-exists as success', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse(422, { message: 'redirect uri already exists' }))
        .mockResolvedValueOnce(mockResponse(409, { message: 'already exists' }))
        .mockResolvedValueOnce(OK());

      const outcome = await autoConfigureWorkOSEnvironment('sk_test_123', 'nextjs', 3000);

      expect(outcome).not.toBeNull();
      expect(outcome!.results.redirectUri).toEqual({ success: true, alreadyExists: true });
      expect(outcome!.results.corsOrigin).toEqual({ success: true, alreadyExists: true });
    });

    it('retries with the recovered key after a 401 (re-auth → retry)', async () => {
      // First round: all three calls 401 (Promise.all rejects on the first)
      mockFetch.mockResolvedValueOnce(UNAUTHORIZED()).mockResolvedValueOnce(UNAUTHORIZED()).mockResolvedValueOnce(OK());
      // Second round: everything succeeds with the fresh key
      mockFetch.mockResolvedValue(OK());
      const onUnauthorized = vi.fn().mockResolvedValue({ apiKey: 'sk_fresh' });

      const outcome = await autoConfigureWorkOSEnvironment('sk_stale', 'nextjs', 3000, { onUnauthorized });

      expect(onUnauthorized).toHaveBeenCalledTimes(1);
      expect(onUnauthorized).toHaveBeenCalledWith(1);
      expect(outcome).not.toBeNull();
      expect(outcome!.apiKey).toBe('sk_fresh');
      // Pasted-key style recovery carries no clientId
      expect(outcome!.clientId).toBeUndefined();
      // The retry used the fresh key
      const lastCall = mockFetch.mock.calls.at(-1)!;
      expect(lastCall[1].headers.Authorization).toBe('Bearer sk_fresh');
    });

    it('propagates the paired clientId when re-auth recovers into a different environment', async () => {
      // First round 401s; retry succeeds with credentials from a DIFFERENT environment
      mockFetch.mockResolvedValueOnce(UNAUTHORIZED()).mockResolvedValueOnce(UNAUTHORIZED()).mockResolvedValueOnce(OK());
      mockFetch.mockResolvedValue(OK());
      const onUnauthorized = vi.fn().mockResolvedValue({ apiKey: 'sk_other_env', clientId: 'client_other_env' });

      const outcome = await autoConfigureWorkOSEnvironment('sk_stale', 'nextjs', 3000, { onUnauthorized });

      expect(outcome).not.toBeNull();
      expect(outcome!.apiKey).toBe('sk_other_env');
      // The clientId paired with the new key must surface so callers don't
      // mix the new key with the original environment's client ID.
      expect(outcome!.clientId).toBe('client_other_env');
      const lastCall = mockFetch.mock.calls.at(-1)!;
      expect(lastCall[1].headers.Authorization).toBe('Bearer sk_other_env');
    });

    it('falls back to specific manual instructions when the user declines recovery', async () => {
      mockFetch.mockResolvedValue(UNAUTHORIZED());
      const onUnauthorized = vi.fn().mockResolvedValue(null);

      const outcome = await autoConfigureWorkOSEnvironment('sk_stale', 'nextjs', 3000, { onUnauthorized });

      expect(outcome).toBeNull();
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
      // One round of API calls only — no retry after decline
      expect(mockFetch).toHaveBeenCalledTimes(3);
      // Manual instructions are specific: values + where to set them
      const manualLine = mockUi.log.info.mock.calls.map((c) => String(c[0])).find((m) => m.includes('manually'));
      expect(manualLine).toContain('https://dashboard.workos.com');
      const rows = mockUi.rows.mock.calls.at(-1)![0] as Array<{ key: string; value: string }>;
      expect(rows.map((r) => r.value)).toEqual([
        'http://localhost:3000/callback',
        'http://localhost:3000',
        'http://localhost:3000',
      ]);
    });

    it('keeps recovering when a retry 401s again, then falls back after decline', async () => {
      mockFetch.mockResolvedValue(UNAUTHORIZED());
      const onUnauthorized = vi
        .fn()
        .mockResolvedValueOnce({ apiKey: 'sk_fresh' }) // first recovery: retry
        .mockResolvedValueOnce(null); // second prompt: decline

      const outcome = await autoConfigureWorkOSEnvironment('sk_stale', 'nextjs', 3000, { onUnauthorized });

      expect(outcome).toBeNull();
      expect(onUnauthorized).toHaveBeenCalledTimes(2);
      // Two rounds of API calls (initial + one retry), then stopped
      expect(mockFetch).toHaveBeenCalledTimes(6);
    });

    it('bounds recovery loops (no infinite retries when every key 401s)', async () => {
      mockFetch.mockResolvedValue(UNAUTHORIZED());
      // Distinct key per recovery so the same-key guard doesn't short-circuit.
      const onUnauthorized = vi
        .fn()
        .mockResolvedValueOnce({ apiKey: 'sk_new_1' })
        .mockResolvedValueOnce({ apiKey: 'sk_new_2' });

      const outcome = await autoConfigureWorkOSEnvironment('sk_stale', 'nextjs', 3000, { onUnauthorized });

      expect(outcome).toBeNull();
      // MAX_UNAUTHORIZED_RECOVERIES = 2 → 2 prompts, 3 total API rounds
      expect(onUnauthorized).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledTimes(9);
    });

    it('does not retry when recovery returns the same key', async () => {
      mockFetch.mockResolvedValue(UNAUTHORIZED());
      const onUnauthorized = vi.fn().mockResolvedValue({ apiKey: 'sk_stale' });

      const outcome = await autoConfigureWorkOSEnvironment('sk_stale', 'nextjs', 3000, { onUnauthorized });

      expect(outcome).toBeNull();
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('falls back to manual instructions when the recovery hook throws', async () => {
      mockFetch.mockResolvedValue(UNAUTHORIZED());
      const onUnauthorized = vi.fn().mockRejectedValue(new Error('browser exploded'));

      const outcome = await autoConfigureWorkOSEnvironment('sk_stale', 'nextjs', 3000, { onUnauthorized });

      expect(outcome).toBeNull();
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('does not attempt recovery for non-401 errors', async () => {
      mockFetch.mockResolvedValue(mockResponse(500, { message: 'Internal Server Error' }));
      const onUnauthorized = vi.fn().mockResolvedValue({ apiKey: 'sk_fresh' });

      const outcome = await autoConfigureWorkOSEnvironment('sk_test_123', 'nextjs', 3000, { onUnauthorized });

      expect(outcome).toBeNull();
      expect(onUnauthorized).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockUi.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not configure WorkOS dashboard: Internal Server Error'),
      );
    });

    it('explains the likely cause on 401', async () => {
      mockFetch.mockResolvedValue(UNAUTHORIZED());
      const onUnauthorized = vi.fn().mockResolvedValue(null);

      await autoConfigureWorkOSEnvironment('sk_stale', 'nextjs', 3000, { onUnauthorized });

      const warnings = mockUi.log.warn.mock.calls.map((c) => String(c[0]));
      expect(warnings.some((m) => m.includes('401'))).toBe(true);
      const infos = mockUi.log.info.mock.calls.map((c) => String(c[0]));
      expect(infos.some((m) => m.includes('expired') && m.includes('different environment'))).toBe(true);
    });
  });

  describe('promptForUnauthorizedRecovery (default 401 handler)', () => {
    it('returns null when prompting is not allowed (agent/CI mode)', async () => {
      mockIsPromptAllowed.mockReturnValue(false);
      expect(await promptForUnauthorizedRecovery()).toBeNull();
      expect(mockSelect).not.toHaveBeenCalled();
    });

    it('returns null when the user chooses manual setup', async () => {
      mockIsPromptAllowed.mockReturnValue(true);
      mockSelect.mockResolvedValue('manual');

      expect(await promptForUnauthorizedRecovery()).toBeNull();
    });

    it('returns null when the user cancels the prompt', async () => {
      mockIsPromptAllowed.mockReturnValue(true);
      mockSelect.mockResolvedValue(Symbol('cancel'));

      expect(await promptForUnauthorizedRecovery()).toBeNull();
    });

    it('returns the entered key with no clientId (and a pairing warning) when the user pastes a new API key', async () => {
      mockIsPromptAllowed.mockReturnValue(true);
      mockSelect.mockResolvedValue('apikey');
      mockPassword.mockResolvedValue('  sk_pasted  ');

      const recovered = await promptForUnauthorizedRecovery();
      expect(recovered).toEqual({ apiKey: 'sk_pasted' });
      expect(recovered!.clientId).toBeUndefined();
      // The pasted key's environment is unknown — the user is warned that the
      // existing client ID may no longer match.
      const warnings = mockUi.log.warn.mock.calls.map((c) => String(c[0]));
      expect(warnings.some((m) => m.includes('client ID') && m.includes('may no longer match'))).toBe(true);
    });

    it('re-authenticates and returns fresh staging credentials', async () => {
      mockIsPromptAllowed.mockReturnValue(true);
      mockSelect.mockResolvedValue('reauth');
      mockEnsureAuthenticated.mockResolvedValue({ authenticated: true });
      mockGetAccessToken.mockReturnValue('oauth-token');
      mockFetchStagingCredentials.mockResolvedValue({ clientId: 'client_new', apiKey: 'sk_new' });

      // Both credentials surface — the fresh key may belong to a different
      // environment, so the paired clientId must travel with it.
      expect(await promptForUnauthorizedRecovery()).toEqual({ apiKey: 'sk_new', clientId: 'client_new' });
      expect(mockFetchStagingCredentials).toHaveBeenCalledWith('oauth-token');
      expect(mockSaveStagingCredentials).toHaveBeenCalledWith({ clientId: 'client_new', apiKey: 'sk_new' });
    });

    it('returns null when re-authentication fails', async () => {
      mockIsPromptAllowed.mockReturnValue(true);
      mockSelect.mockResolvedValue('reauth');
      mockEnsureAuthenticated.mockRejectedValue(new Error('device auth timed out'));

      expect(await promptForUnauthorizedRecovery()).toBeNull();
      expect(mockUi.log.warn).toHaveBeenCalledWith(expect.stringContaining('Re-authentication failed'));
    });
  });

  describe('DashboardConfigError', () => {
    it('carries the HTTP status', () => {
      const err = new DashboardConfigError('Unauthorized', 401);
      expect(err.status).toBe(401);
      expect(err.message).toBe('Unauthorized');
      expect(err).toBeInstanceOf(Error);
    });
  });
});

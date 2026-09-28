import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@workos-inc/node';
import { DashboardGraphqlError } from './dashboard-graphql.js';
import { WorkOSApiError } from './workos-api.js';
import {
  DashboardConfigError,
  isConfigurationUnauthorized,
  recoverConfigurationAccess,
} from './configuration-recovery.js';
import { getCredentials, clearCredentials, saveCredentials, updateTokens } from './credential-store.js';
import { runLogin } from '../commands/login.js';
import { refreshAccessToken } from './token-refresh-client.js';
import ui, { CANCEL } from '../utils/ui.js';
import { setInteractionMode, resetInteractionModeForTests } from '../utils/interaction-mode.js';
import { setOutputMode } from '../utils/output.js';

// Keep the real credential expiry logic, refresh guard, and ensureAuthenticated.
// Only persistence and external authentication are mocked: no keychain/home reads.
vi.mock('./credential-store.js', () => ({
  getCredentials: vi.fn(),
  hasCredentials: vi.fn(() => true),
  clearCredentials: vi.fn(),
  saveCredentials: vi.fn(),
  updateTokens: vi.fn(),
}));
vi.mock('../commands/login.js', () => ({ runLogin: vi.fn() }));
vi.mock('./token-refresh-client.js', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('./host-probe.js', () => ({ warnIfSandboxed: vi.fn() }));

const fakeSession = {
  accessToken: 'fake_revoked_but_unexpired_token',
  refreshToken: 'fake_refresh_token',
  expiresAt: Date.now() + 3_600_000,
  userId: 'fake_user',
};

describe('revoked but locally unexpired session policy', () => {
  const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCredentials).mockReturnValue(fakeSession);
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    setInteractionMode({ mode: 'human', source: 'flag' });
    setOutputMode('human');
    vi.spyOn(ui, 'select').mockResolvedValue('retry');
    vi.spyOn(ui.log, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (tty) Object.defineProperty(process.stdin, 'isTTY', tty);
    else Reflect.deleteProperty(process.stdin, 'isTTY');
    resetInteractionModeForTests();
    setOutputMode('human');
  });

  it.each(['human', 'json', 'agent', 'ci'] as const)(
    'gives actionable manual guidance without replacing a rejected session in %s mode',
    async (mode) => {
      if (mode === 'json') setOutputMode('json');
      else setInteractionMode({ mode, source: 'flag' });
      const result = await recoverConfigurationAccess({ token: fakeSession.accessToken });
      expect(result).toEqual({ reason: expect.stringContaining('auth login` alone may reuse') });
      if ('reason' in result) {
        expect(result.reason).toContain('auth logout');
        expect(result.reason).toContain('same account');
        expect(result.reason).toContain('will not log you out automatically');
        expect(result.reason).not.toContain(fakeSession.accessToken);
      }
      expect(ui.select).toHaveBeenCalledTimes(mode === 'human' ? 1 : 0);
      expect(ui.log.info).not.toHaveBeenCalled();
      expect(runLogin).not.toHaveBeenCalled();
      expect(refreshAccessToken).not.toHaveBeenCalled();
      expect(clearCredentials).not.toHaveBeenCalled();
      expect(saveCredentials).not.toHaveBeenCalled();
      expect(updateTokens).not.toHaveBeenCalled();
    },
  );

  it.each(['manual', CANCEL])('does not run authentication when recovery is declined or cancelled', async (choice) => {
    vi.mocked(ui.select).mockResolvedValue(choice);
    const result = await recoverConfigurationAccess({ token: fakeSession.accessToken });
    expect(result).toMatchObject({ reason: expect.stringContaining(choice === CANCEL ? 'cancelled' : 'declined') });
    expect(getCredentials).not.toHaveBeenCalled();
    expect(runLogin).not.toHaveBeenCalled();
    expect(clearCredentials).not.toHaveBeenCalled();
  });
});

describe('configuration Unauthorized classification', () => {
  it.each([
    new UnauthorizedException('fake-request-id'),
    new WorkOSApiError('Unauthorized', 401),
    new DashboardConfigError(401),
    new DashboardGraphqlError('Session rejected', 'forbidden', 401),
  ])('accepts typed 401 from each supported transport: %s', (error) => {
    expect(isConfigurationUnauthorized(error)).toBe(true);
  });

  it.each([
    new Error('Unauthorized HTTP 401'),
    { status: 401, message: 'Unauthorized' },
    new WorkOSApiError('Unauthorized', 403),
    new DashboardConfigError(422),
    new DashboardGraphqlError('Unauthorized', 'forbidden', 403),
    new DashboardGraphqlError('Unauthorized', 'network_error'),
    new DashboardGraphqlError('Unauthorized', 'graphql_error'),
  ])('does not infer authentication failure from an untyped message: %s', (error) => {
    expect(isConfigurationUnauthorized(error)).toBe(false);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Type-only import is erased at build time, so it does not load the module
// before vi.mock applies (the runtime handler is loaded via dynamic import below).
import type { VerifyLoginOptions } from './verify-login.js';

const mockSdk = {
  userManagement: {
    createUser: vi.fn(),
    authenticateWithPassword: vi.fn(),
    authenticateWithMagicAuth: vi.fn(),
    createMagicAuth: vi.fn(),
    deleteUser: vi.fn(),
  },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

const { setOutputMode } = await import('../utils/output.js');
const { CliExit } = await import('../utils/cli-exit.js');
const { runVerifyLogin } = await import('./verify-login.js');

function baseOptions(overrides: Partial<VerifyLoginOptions> = {}): VerifyLoginOptions {
  return {
    apiKey: 'sk_test_x',
    clientId: 'client_x',
    baseUrl: 'https://api.workos.com',
    envType: 'sandbox',
    envName: 'sandbox',
    method: 'password',
    ...overrides,
  };
}

/** Run the handler and return the thrown CliExit (fails the test if none thrown). */
async function expectCliExit(options: VerifyLoginOptions): Promise<InstanceType<typeof CliExit>> {
  try {
    await runVerifyLogin(options);
  } catch (err) {
    expect(err).toBeInstanceOf(CliExit);
    return err as InstanceType<typeof CliExit>;
  }
  throw new Error('Expected runVerifyLogin to throw CliExit, but it resolved');
}

describe('verify-login', () => {
  let consoleOutput: string[];
  let errorOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    errorOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errorOutput.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('smoke: exports runVerifyLogin', () => {
    expect(typeof runVerifyLogin).toBe('function');
  });

  it('happy path: create → authenticate → assert tokens → cleanup, in order', async () => {
    mockSdk.userManagement.createUser.mockResolvedValue({ id: 'user_x' });
    mockSdk.userManagement.authenticateWithPassword.mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
      user: {},
    });
    mockSdk.userManagement.deleteUser.mockResolvedValue(undefined);

    await runVerifyLogin(baseOptions());

    expect(mockSdk.userManagement.createUser).toHaveBeenCalledTimes(1);
    const createArgs = mockSdk.userManagement.createUser.mock.calls[0][0];
    expect(createArgs).toEqual(expect.objectContaining({ emailVerified: true }));
    expect(createArgs.email).toMatch(/^verify-login\+.*@example\.workos\.dev$/);
    expect(typeof createArgs.password).toBe('string');
    expect(createArgs.password.length).toBeGreaterThan(0);

    expect(mockSdk.userManagement.authenticateWithPassword).toHaveBeenCalledTimes(1);
    const authArgs = mockSdk.userManagement.authenticateWithPassword.mock.calls[0][0];
    expect(authArgs).toEqual(expect.objectContaining({ clientId: 'client_x' }));
    // Same throwaway credentials must be reused for the authenticate step.
    expect(authArgs.email).toBe(createArgs.email);
    expect(authArgs.password).toBe(createArgs.password);

    expect(mockSdk.userManagement.deleteUser).toHaveBeenCalledTimes(1);
    expect(mockSdk.userManagement.deleteUser).toHaveBeenCalledWith('user_x');

    expect(consoleOutput.some((l) => /passed/i.test(l))).toBe(true);
  });

  it('cleanup-on-failure: authenticate rejects but deleteUser still runs; exit 1', async () => {
    mockSdk.userManagement.createUser.mockResolvedValue({ id: 'user_x' });
    mockSdk.userManagement.authenticateWithPassword.mockRejectedValue(new Error('invalid credentials'));
    mockSdk.userManagement.deleteUser.mockResolvedValue(undefined);

    const exit = await expectCliExit(baseOptions());

    expect(exit.exitCode).toBe(1);
    expect(mockSdk.userManagement.deleteUser).toHaveBeenCalledWith('user_x');
  });

  it('createUser throws: no orphan, verdict false, no deleteUser call; exit 1', async () => {
    mockSdk.userManagement.createUser.mockRejectedValue(new Error('boom'));

    const exit = await expectCliExit(baseOptions());

    expect(exit.exitCode).toBe(1);
    expect(mockSdk.userManagement.authenticateWithPassword).not.toHaveBeenCalled();
    expect(mockSdk.userManagement.deleteUser).not.toHaveBeenCalled();
  });

  it('orphaned user: cleanup fails after a passing verification; resolves (exit 0)', async () => {
    mockSdk.userManagement.createUser.mockResolvedValue({ id: 'user_x' });
    mockSdk.userManagement.authenticateWithPassword.mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
      user: {},
    });
    mockSdk.userManagement.deleteUser.mockRejectedValue(new Error('network'));

    // Verification passed → a leaked user does not fail the login verdict.
    await expect(runVerifyLogin(baseOptions())).resolves.toBeUndefined();

    expect(mockSdk.userManagement.deleteUser).toHaveBeenCalledWith('user_x');
    expect(consoleOutput.some((l) => l.includes('user_x'))).toBe(true);
  });

  it('production refusal (env.type): NO SDK calls, exit 1', async () => {
    const exit = await expectCliExit(baseOptions({ envType: 'production' }));

    expect(exit.exitCode).toBe(1);
    expect(mockSdk.userManagement.createUser).not.toHaveBeenCalled();
    expect(mockSdk.userManagement.authenticateWithPassword).not.toHaveBeenCalled();
    expect(mockSdk.userManagement.deleteUser).not.toHaveBeenCalled();
  });

  it('production refusal (sk_live_ key): NO SDK calls, exit 1', async () => {
    const exit = await expectCliExit(baseOptions({ envType: null, apiKey: 'sk_live_x' }));

    expect(exit.exitCode).toBe(1);
    expect(mockSdk.userManagement.createUser).not.toHaveBeenCalled();
    expect(mockSdk.userManagement.authenticateWithPassword).not.toHaveBeenCalled();
    expect(mockSdk.userManagement.deleteUser).not.toHaveBeenCalled();
  });

  it('missing clientId: structured error, NO SDK calls', async () => {
    const exit = await expectCliExit(baseOptions({ clientId: undefined }));

    expect(exit.exitCode).toBe(1);
    expect(mockSdk.userManagement.createUser).not.toHaveBeenCalled();
    // Human mode: the error message references configuring a client id.
    expect(errorOutput.some((l) => /client id/i.test(l))).toBe(true);
  });

  it('tokens missing: verdict false, deleteUser still called; exit 1', async () => {
    mockSdk.userManagement.createUser.mockResolvedValue({ id: 'user_x' });
    mockSdk.userManagement.authenticateWithPassword.mockResolvedValue({
      accessToken: '',
      refreshToken: '',
      user: {},
    });
    mockSdk.userManagement.deleteUser.mockResolvedValue(undefined);

    const exit = await expectCliExit(baseOptions());

    expect(exit.exitCode).toBe(1);
    expect(mockSdk.userManagement.deleteUser).toHaveBeenCalledWith('user_x');
  });

  describe('JSON output mode', () => {
    beforeEach(() => {
      setOutputMode('json');
    });

    afterEach(() => {
      setOutputMode('human');
    });

    it('verdict shape (happy path)', async () => {
      mockSdk.userManagement.createUser.mockResolvedValue({ id: 'user_x' });
      mockSdk.userManagement.authenticateWithPassword.mockResolvedValue({
        accessToken: 'a',
        refreshToken: 'r',
        user: {},
      });
      mockSdk.userManagement.deleteUser.mockResolvedValue(undefined);

      await runVerifyLogin(baseOptions());

      const output = JSON.parse(consoleOutput[0]);
      expect(output.success).toBe(true);
      expect(output.method).toBe('password');
      expect(output.environment).toBe('sandbox');
      expect(Array.isArray(output.checks)).toBe(true);
      expect(output.checks).toHaveLength(3);
      for (const check of output.checks) {
        expect(check).toHaveProperty('name');
        expect(check).toHaveProperty('passed');
        expect(check).toHaveProperty('detail');
      }
      expect(output.userId).toBe('user_x');
      expect(output.userCleanedUp).toBe(true);
      expect(output.orphanedUserId).toBeNull();
    });

    it('verdict shape (failed auth)', async () => {
      mockSdk.userManagement.createUser.mockResolvedValue({ id: 'user_x' });
      mockSdk.userManagement.authenticateWithPassword.mockRejectedValue(new Error('invalid credentials'));
      mockSdk.userManagement.deleteUser.mockResolvedValue(undefined);

      const exit = await expectCliExit(baseOptions());
      expect(exit.exitCode).toBe(1);

      const output = JSON.parse(consoleOutput[0]);
      expect(output.success).toBe(false);
      expect(output.userCleanedUp).toBe(true);
      const authCheck = output.checks.find((c: { name: string }) => c.name === 'authenticate');
      expect(authCheck.passed).toBe(false);
    });

    it('production refusal emits error envelope with production_env_refused code', async () => {
      const exit = await expectCliExit(baseOptions({ envType: 'production' }));
      expect(exit.exitCode).toBe(1);
      expect(JSON.parse(errorOutput[0]).error.code).toBe('production_env_refused');
      expect(mockSdk.userManagement.createUser).not.toHaveBeenCalled();
    });

    it('missing clientId emits error envelope with missing_client_id code', async () => {
      const exit = await expectCliExit(baseOptions({ clientId: undefined }));
      expect(exit.exitCode).toBe(1);
      expect(JSON.parse(errorOutput[0]).error.code).toBe('missing_client_id');
      expect(mockSdk.userManagement.createUser).not.toHaveBeenCalled();
    });
  });
});

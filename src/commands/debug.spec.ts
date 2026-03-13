import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock credentials
const mockGetCredentials = vi.fn();
const mockSaveCredentials = vi.fn();
const mockClearCredentials = vi.fn();
const mockIsTokenExpired = vi.fn();
const mockDiagnoseCredentials = vi.fn();
const mockGetCredentialsPath = vi.fn(() => '/home/user/.workos/credentials.json');
const mockSetInsecureStorage = vi.fn();

vi.mock('../lib/credentials.js', () => ({
  getCredentials: (...args: unknown[]) => mockGetCredentials(...args),
  saveCredentials: (...args: unknown[]) => mockSaveCredentials(...args),
  clearCredentials: (...args: unknown[]) => mockClearCredentials(...args),
  isTokenExpired: (...args: unknown[]) => mockIsTokenExpired(...args),
  diagnoseCredentials: (...args: unknown[]) => mockDiagnoseCredentials(...args),
  getCredentialsPath: (...args: unknown[]) => mockGetCredentialsPath(...args),
  setInsecureStorage: (...args: unknown[]) => mockSetInsecureStorage(...args),
}));

// Mock config store
const mockGetConfig = vi.fn();
const mockSaveConfig = vi.fn();
const mockClearConfig = vi.fn();
const mockGetActiveEnvironment = vi.fn();
const mockGetConfigPath = vi.fn(() => '/home/user/.workos/config.json');
const mockSetInsecureConfigStorage = vi.fn();
const mockDiagnoseConfig = vi.fn();

vi.mock('../lib/config-store.js', () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
  clearConfig: (...args: unknown[]) => mockClearConfig(...args),
  getActiveEnvironment: (...args: unknown[]) => mockGetActiveEnvironment(...args),
  getConfigPath: (...args: unknown[]) => mockGetConfigPath(...args),
  setInsecureConfigStorage: (...args: unknown[]) => mockSetInsecureConfigStorage(...args),
  diagnoseConfig: (...args: unknown[]) => mockDiagnoseConfig(...args),
}));

// Mock output
let jsonMode = false;
vi.mock('../utils/output.js', () => ({
  isJsonMode: () => jsonMode,
  outputJson: vi.fn((data: unknown) => console.log(JSON.stringify(data))),
  outputError: vi.fn((err: { message: string }) => console.error(err.message)),
  exitWithError: vi.fn((err: { message: string }) => {
    throw new Error(err.message);
  }),
}));

// Mock clack
const mockConfirm = vi.fn();
const mockIsCancel = vi.fn(() => false);
vi.mock('../utils/clack.js', () => ({
  default: {
    confirm: (...args: unknown[]) => mockConfirm(...args),
    isCancel: (...args: unknown[]) => mockIsCancel(...args),
    log: {
      info: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
    },
  },
}));

// Mock environment
const mockIsNonInteractive = vi.fn(() => false);
vi.mock('../utils/environment.js', () => ({
  isNonInteractiveEnvironment: () => mockIsNonInteractive(),
}));

const { runDebugState, runDebugReset, runDebugSimulate, runDebugToken, runDebugEnv } = await import('./debug.js');

const makeCreds = (overrides = {}) => ({
  accessToken: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEyMyIsImV4cCI6OTk5OTk5OTk5OX0.sig',
  expiresAt: Date.now() + 3600_000,
  userId: 'user_123',
  email: 'test@example.com',
  refreshToken: 'refresh_abc123',
  ...overrides,
});

const makeConfig = (overrides = {}) => ({
  activeEnvironment: 'default',
  environments: {
    default: {
      name: 'default',
      type: 'sandbox' as const,
      apiKey: 'sk_test_abc123def456',
      clientId: 'client_123',
    },
  },
  ...overrides,
});

describe('debug commands', () => {
  let consoleOutput: string[];
  let consoleErrors: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    jsonMode = false;
    consoleOutput = [];
    consoleErrors = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '));
    });
    mockDiagnoseCredentials.mockReturnValue([
      'file: /home/user/.workos/credentials.json (exists=true)',
      'keyring: found, userId=user_123, expired=false, hasRefreshToken=true',
      'insecureStorage=false',
    ]);
    mockDiagnoseConfig.mockReturnValue([
      'file: /home/user/.workos/config.json (exists=true)',
      'keyring: found, active=default, environments=1',
      'insecureStorage=false',
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('debug state', () => {
    it('outputs credentials and config when present', async () => {
      mockGetCredentials.mockReturnValue(makeCreds());
      mockGetConfig.mockReturnValue(makeConfig());
      mockIsTokenExpired.mockReturnValue(false);

      await runDebugState({ showSecrets: false });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Credentials');
      expect(output).toContain('user_123');
      expect(output).toContain('Config');
      expect(output).toContain('sandbox');
    });

    it('shows present: false when no credentials', async () => {
      mockGetCredentials.mockReturnValue(null);
      mockGetConfig.mockReturnValue(null);
      mockDiagnoseCredentials.mockReturnValue([
        'file: /home/user/.workos/credentials.json (exists=false)',
        'insecureStorage=false',
      ]);
      mockDiagnoseConfig.mockReturnValue([
        'file: /home/user/.workos/config.json (exists=false)',
        'keyring: empty (getPassword returned null)',
        'insecureStorage=false',
      ]);

      await runDebugState({ showSecrets: false });

      const output = consoleOutput.join('\n');
      expect(output).toContain('false');
    });

    it('redacts tokens and keys by default', async () => {
      const creds = makeCreds();
      mockGetCredentials.mockReturnValue(creds);
      mockGetConfig.mockReturnValue(makeConfig());
      mockIsTokenExpired.mockReturnValue(false);

      await runDebugState({ showSecrets: false });

      const output = consoleOutput.join('\n');
      expect(output).not.toContain(creds.accessToken);
      expect(output).toContain('****');
    });

    it('shows full values with --show-secrets', async () => {
      const creds = makeCreds();
      mockGetCredentials.mockReturnValue(creds);
      mockGetConfig.mockReturnValue(makeConfig());
      mockIsTokenExpired.mockReturnValue(false);

      await runDebugState({ showSecrets: true });

      const output = consoleOutput.join('\n');
      expect(output).toContain(creds.accessToken);
    });

    it('outputs valid JSON in json mode', async () => {
      jsonMode = true;
      mockGetCredentials.mockReturnValue(makeCreds());
      mockGetConfig.mockReturnValue(makeConfig());
      mockIsTokenExpired.mockReturnValue(false);

      await runDebugState({ showSecrets: false });

      expect(consoleOutput).toHaveLength(1);
      const parsed = JSON.parse(consoleOutput[0]);
      expect(parsed.credentials.present).toBe(true);
      expect(parsed.credentials.userId).toBe('user_123');
      expect(parsed.config.present).toBe(true);
      expect(parsed.storage.credentialsPath).toBeDefined();
    });

    it('shows correct storage source from diagnostics', async () => {
      mockGetCredentials.mockReturnValue(makeCreds());
      mockGetConfig.mockReturnValue(makeConfig());
      mockIsTokenExpired.mockReturnValue(false);

      await runDebugState({ showSecrets: false });

      const output = consoleOutput.join('\n');
      expect(output).toContain('keyring');
    });

    it('shows file source when insecure storage', async () => {
      mockGetCredentials.mockReturnValue(makeCreds());
      mockGetConfig.mockReturnValue(makeConfig());
      mockIsTokenExpired.mockReturnValue(false);
      mockDiagnoseCredentials.mockReturnValue([
        'file: /home/user/.workos/credentials.json (exists=true)',
        'insecureStorage=true',
      ]);
      mockDiagnoseConfig.mockReturnValue([
        'file: /home/user/.workos/config.json (exists=true)',
        'insecureStorage=true',
      ]);

      jsonMode = true;
      await runDebugState({ showSecrets: false });

      const parsed = JSON.parse(consoleOutput[0]);
      expect(parsed.credentials.source).toBe('file');
    });
  });

  describe('debug reset', () => {
    it('clears both credentials and config by default', async () => {
      mockConfirm.mockResolvedValue(true);

      await runDebugReset({ force: false, credentialsOnly: false, configOnly: false });

      expect(mockClearCredentials).toHaveBeenCalled();
      expect(mockClearConfig).toHaveBeenCalled();
    });

    it('--credentials-only clears only credentials', async () => {
      mockConfirm.mockResolvedValue(true);

      await runDebugReset({ force: false, credentialsOnly: true, configOnly: false });

      expect(mockClearCredentials).toHaveBeenCalled();
      expect(mockClearConfig).not.toHaveBeenCalled();
    });

    it('--config-only clears only config', async () => {
      mockConfirm.mockResolvedValue(true);

      await runDebugReset({ force: false, credentialsOnly: false, configOnly: true });

      expect(mockClearConfig).toHaveBeenCalled();
      expect(mockClearCredentials).not.toHaveBeenCalled();
    });

    it('--force skips confirmation', async () => {
      await runDebugReset({ force: true, credentialsOnly: false, configOnly: false });

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockClearCredentials).toHaveBeenCalled();
      expect(mockClearConfig).toHaveBeenCalled();
    });

    it('both --credentials-only and --config-only clears both', async () => {
      mockConfirm.mockResolvedValue(true);

      await runDebugReset({ force: false, credentialsOnly: true, configOnly: true });

      expect(mockClearCredentials).toHaveBeenCalled();
      expect(mockClearConfig).toHaveBeenCalled();
    });

    it('errors in non-interactive mode without --force', async () => {
      mockIsNonInteractive.mockReturnValue(true);

      await expect(runDebugReset({ force: false, credentialsOnly: false, configOnly: false })).rejects.toThrow(
        'Use --force to reset in non-interactive mode',
      );
    });

    it('outputs JSON on reset', async () => {
      jsonMode = true;

      await runDebugReset({ force: true, credentialsOnly: false, configOnly: false });

      const parsed = JSON.parse(consoleOutput[0]);
      expect(parsed.cleared).toBe(true);
      expect(parsed.credentials).toBe(true);
      expect(parsed.config).toBe(true);
    });
  });

  describe('debug simulate', () => {
    it('--expired-token sets expiresAt to the past', async () => {
      const creds = makeCreds();
      mockGetCredentials.mockReturnValue(creds);

      await runDebugSimulate({
        expiredToken: true,
        noKeyring: false,
        unclaimed: false,
        noAuth: false,
      });

      expect(mockSaveCredentials).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: expect.any(Number) }));
      const saved = mockSaveCredentials.mock.calls[0][0];
      expect(saved.expiresAt).toBeLessThan(Date.now());
    });

    it('--no-auth clears credentials but preserves config', async () => {
      await runDebugSimulate({
        expiredToken: false,
        noKeyring: false,
        unclaimed: false,
        noAuth: true,
      });

      expect(mockClearCredentials).toHaveBeenCalled();
      expect(mockClearConfig).not.toHaveBeenCalled();
    });

    it('--unclaimed writes unclaimed environment config', async () => {
      mockGetConfig.mockReturnValue(null);

      await runDebugSimulate({
        expiredToken: false,
        noKeyring: false,
        unclaimed: true,
        noAuth: false,
      });

      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          activeEnvironment: 'simulated-unclaimed',
          environments: expect.objectContaining({
            'simulated-unclaimed': expect.objectContaining({ type: 'unclaimed' }),
          }),
        }),
      );
    });

    it('rejects contradictory --expired-token and --no-auth', async () => {
      await expect(
        runDebugSimulate({
          expiredToken: true,
          noKeyring: false,
          unclaimed: false,
          noAuth: true,
        }),
      ).rejects.toThrow("can't expire a cleared token");
    });

    it('requires at least one flag', async () => {
      await expect(
        runDebugSimulate({
          expiredToken: false,
          noKeyring: false,
          unclaimed: false,
          noAuth: false,
        }),
      ).rejects.toThrow('Specify at least one simulation flag');
    });

    it('allows combinable flags (--expired-token --no-keyring)', async () => {
      const creds = makeCreds();
      const config = makeConfig();
      mockGetCredentials.mockReturnValue(creds);
      mockGetConfig.mockReturnValue(config);

      await runDebugSimulate({
        expiredToken: true,
        noKeyring: true,
        unclaimed: false,
        noAuth: false,
      });

      expect(mockSetInsecureStorage).toHaveBeenCalledWith(true);
      expect(mockSetInsecureConfigStorage).toHaveBeenCalledWith(true);
      expect(mockSaveCredentials).toHaveBeenCalled();
      // saveCredentials called twice: once for keyring migration, once for expired token
      const lastCall = mockSaveCredentials.mock.calls[mockSaveCredentials.mock.calls.length - 1][0];
      expect(lastCall.expiresAt).toBeLessThan(Date.now());
    });

    it('outputs JSON with actions', async () => {
      jsonMode = true;
      mockGetConfig.mockReturnValue(null);

      await runDebugSimulate({
        expiredToken: false,
        noKeyring: false,
        unclaimed: true,
        noAuth: false,
      });

      const parsed = JSON.parse(consoleOutput[0]);
      expect(parsed.simulated).toBe(true);
      expect(parsed.actions).toHaveLength(1);
      expect(parsed.actions[0]).toContain('unclaimed');
    });
  });

  describe('debug token', () => {
    it('decodes valid JWT and shows claims', async () => {
      // Create a real JWT-like token
      const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({ sub: 'user_123', exp: 9999999999, iss: 'https://api.workos.com' }),
      ).toString('base64url');
      const token = `${header}.${payload}.fakesig`;

      mockGetCredentials.mockReturnValue(makeCreds({ accessToken: token }));
      mockIsTokenExpired.mockReturnValue(false);

      jsonMode = true;
      await runDebugToken();

      const parsed = JSON.parse(consoleOutput[0]);
      expect(parsed.present).toBe(true);
      expect(parsed.format).toBe('jwt');
      expect(parsed.claims.sub).toBe('user_123');
      expect(parsed.claims.iss).toBe('https://api.workos.com');
      expect(parsed.refreshToken.present).toBe(true);
    });

    it('handles missing credentials', async () => {
      mockGetCredentials.mockReturnValue(null);

      jsonMode = true;
      await runDebugToken();

      const parsed = JSON.parse(consoleOutput[0]);
      expect(parsed.present).toBe(false);
    });

    it('handles opaque (non-JWT) tokens', async () => {
      mockGetCredentials.mockReturnValue(makeCreds({ accessToken: 'opaque_token_value' }));
      mockIsTokenExpired.mockReturnValue(false);

      jsonMode = true;
      await runDebugToken();

      const parsed = JSON.parse(consoleOutput[0]);
      expect(parsed.present).toBe(true);
      expect(parsed.format).toBe('opaque');
      expect(parsed.claims).toBeNull();
    });

    it('shows correct expiry status when expired', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: 'user_123', exp: 1000 })).toString('base64url');
      const token = `${header}.${payload}.sig`;

      mockGetCredentials.mockReturnValue(makeCreds({ accessToken: token, expiresAt: Date.now() - 60_000 }));
      mockIsTokenExpired.mockReturnValue(true);

      jsonMode = true;
      await runDebugToken();

      const parsed = JSON.parse(consoleOutput[0]);
      expect(parsed.expired).toBe(true);
      expect(parsed.expiresIn).toContain('expired');
    });

    it('shows human-readable output for JWT', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: 'user_123', exp: 9999999999 })).toString('base64url');
      const token = `${header}.${payload}.sig`;

      mockGetCredentials.mockReturnValue(makeCreds({ accessToken: token }));
      mockIsTokenExpired.mockReturnValue(false);

      await runDebugToken();

      const output = consoleOutput.join('\n');
      expect(output).toContain('JWT Token');
      expect(output).toContain('Claims');
      expect(output).toContain('sub');
    });

    it('shows human-readable output for opaque token', async () => {
      mockGetCredentials.mockReturnValue(makeCreds({ accessToken: 'not-a-jwt' }));
      mockIsTokenExpired.mockReturnValue(false);

      await runDebugToken();

      const output = consoleOutput.join('\n');
      expect(output).toContain('Opaque Token');
    });
  });

  describe('debug env', () => {
    it('shows set env vars with values', async () => {
      process.env.WORKOS_FORCE_TTY = '1';

      await runDebugEnv();

      const output = consoleOutput.join('\n');
      expect(output).toContain('WORKOS_FORCE_TTY');
      expect(output).toContain('1');

      delete process.env.WORKOS_FORCE_TTY;
    });

    it('shows unset env vars with descriptions', async () => {
      delete process.env.WORKOS_API_KEY;

      await runDebugEnv();

      const output = consoleOutput.join('\n');
      expect(output).toContain('WORKOS_API_KEY');
      expect(output).toContain('Bypasses credential resolution');
    });

    it('outputs valid JSON in json mode', async () => {
      jsonMode = true;
      process.env.WORKOS_NO_PROMPT = '1';

      await runDebugEnv();

      const parsed = JSON.parse(consoleOutput[0]);
      expect(parsed.variables.WORKOS_NO_PROMPT.value).toBe('1');
      expect(parsed.set).toContain('WORKOS_NO_PROMPT');
      expect(parsed.unset).not.toContain('WORKOS_NO_PROMPT');

      delete process.env.WORKOS_NO_PROMPT;
    });

    it('lists all known env vars', async () => {
      jsonMode = true;

      await runDebugEnv();

      const parsed = JSON.parse(consoleOutput[0]);
      expect(Object.keys(parsed.variables)).toContain('WORKOS_API_KEY');
      expect(Object.keys(parsed.variables)).toContain('WORKOS_FORCE_TTY');
      expect(Object.keys(parsed.variables)).toContain('WORKOS_TELEMETRY');
      expect(Object.keys(parsed.variables)).toContain('INSTALLER_DEV');
    });
  });
});

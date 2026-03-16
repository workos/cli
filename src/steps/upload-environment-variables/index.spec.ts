import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import type { InstallerOptions } from '../../utils/types.js';

const { detect, checkExistingVars, uploadEnvVars, readFile } = vi.hoisted(() => ({
  detect: vi.fn<() => Promise<boolean>>(),
  checkExistingVars: vi.fn<() => Promise<string[]>>(),
  uploadEnvVars: vi.fn<(vars: Record<string, string>) => Promise<Record<string, boolean>>>(),
  readFile: vi.fn<(path: string, encoding: string) => Promise<string>>(),
}));

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readFile,
}));

// Default to a detected provider so we reach the upload decision point.
// Use a class (not an arrow fn) so `new VercelEnvironmentProvider()` constructs.
vi.mock('./providers/vercel.js', () => ({
  VercelEnvironmentProvider: class {
    name = 'Vercel';
    detect = detect;
    checkExistingVars = checkExistingVars;
    uploadEnvVars = uploadEnvVars;
  },
}));

vi.mock('../../utils/ui.js', () => ({
  default: {
    select: vi.fn(),
    isCancel: vi.fn(() => false),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), step: vi.fn(), message: vi.fn() },
  },
}));

vi.mock('../../utils/analytics.js', () => ({
  analytics: { capture: vi.fn(), shutdown: vi.fn(), setTag: vi.fn(), stepCompleted: vi.fn() },
}));

const ui = (await import('../../utils/ui.js')).default;
const { uploadEnvironmentVariablesStep } = await import('./index.js');
const { setInteractionMode, resetInteractionModeForTests } = await import('../../utils/interaction-mode.js');

const integration = 'nextjs' as const;
const options: InstallerOptions = {
  installDir: '/proj',
  debug: false,
  forceInstall: false,
  local: false,
  ci: false,
  skipAuth: false,
};

describe('uploadEnvironmentVariablesStep', () => {
  beforeEach(() => {
    resetInteractionModeForTests();
    vi.clearAllMocks();
    vi.mocked(ui.isCancel).mockReturnValue(false);
    detect.mockReset().mockResolvedValue(true);
    checkExistingVars.mockReset().mockResolvedValue([]);
    uploadEnvVars.mockReset().mockResolvedValue({});
    readFile.mockReset().mockRejectedValue(new Error('ENOENT'));
  });

  afterEach(() => {
    resetInteractionModeForTests();
  });

  it('ci mode skips the upload prompt and returns []', async () => {
    setInteractionMode({ mode: 'ci', source: 'env' });

    const result = await uploadEnvironmentVariablesStep({}, { integration, options });

    expect(result).toEqual([]);
    expect(ui.select).not.toHaveBeenCalled();
    expect(checkExistingVars).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(uploadEnvVars).not.toHaveBeenCalled();
  });

  it('human mode reaches the prompt', async () => {
    setInteractionMode({ mode: 'human', source: 'default' });
    vi.mocked(ui.select).mockResolvedValueOnce(false);

    const result = await uploadEnvironmentVariablesStep({}, { integration, options });

    expect(result).toEqual([]);
    expect(ui.select).toHaveBeenCalledOnce();
  });

  it('returns empty when no provider is detected', async () => {
    setInteractionMode({ mode: 'human', source: 'default' });
    detect.mockResolvedValue(false);

    expect(await uploadEnvironmentVariablesStep({ WORKOS_API_KEY: 'sk_test' }, { integration, options })).toEqual([]);
    expect(ui.select).not.toHaveBeenCalled();
    expect(checkExistingVars).not.toHaveBeenCalled();
  });

  it('warns about existing WorkOS vars before prompting', async () => {
    setInteractionMode({ mode: 'human', source: 'default' });
    checkExistingVars.mockResolvedValue(['WORKOS_API_KEY', 'WORKOS_CLIENT_ID', 'NODE_ENV']);
    vi.mocked(ui.select).mockResolvedValueOnce(false);

    await uploadEnvironmentVariablesStep({ WORKOS_API_KEY: 'sk_test' }, { integration, options });

    expect(ui.log.warn).toHaveBeenCalledWith(
      'Found existing WorkOS variables in Vercel: WORKOS_API_KEY, WORKOS_CLIENT_ID. Uploading may fail for these keys.',
    );
    expect(ui.log.warn).toHaveBeenCalledBefore(ui.select);
    expect(readFile).not.toHaveBeenCalled();
    expect(uploadEnvVars).not.toHaveBeenCalled();
  });

  it.each([{ existing: [] }, { existing: ['NODE_ENV', 'VERCEL_URL'] }])(
    'uploads without warning when listed vars are $existing',
    async ({ existing }) => {
      setInteractionMode({ mode: 'human', source: 'default' });
      checkExistingVars.mockResolvedValue(existing);
      vi.mocked(ui.select).mockResolvedValueOnce(true);
      uploadEnvVars.mockResolvedValue({ WORKOS_API_KEY: true });
      const envVars = { WORKOS_API_KEY: 'sk_test' };

      const result = await uploadEnvironmentVariablesStep(envVars, { integration, options });

      expect(ui.log.warn).not.toHaveBeenCalled();
      expect(uploadEnvVars).toHaveBeenCalledWith(envVars);
      expect(result).toEqual(['WORKOS_API_KEY']);
    },
  );

  it('adds the cookie password and Next.js redirect URI from .env.local after consent', async () => {
    setInteractionMode({ mode: 'human', source: 'default' });
    vi.mocked(ui.select).mockResolvedValueOnce(true);
    const redirectUri = 'https://example.com/auth/callback';
    readFile.mockResolvedValue(
      `WORKOS_COOKIE_PASSWORD=test-password\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=${redirectUri}\nWORKOS_API_KEY=stale\nWORKOS_CLAIM_TOKEN=local-only\n`,
    );
    uploadEnvVars.mockResolvedValue({
      WORKOS_API_KEY: true,
      WORKOS_COOKIE_PASSWORD: true,
      NEXT_PUBLIC_WORKOS_REDIRECT_URI: true,
    });

    const result = await uploadEnvironmentVariablesStep({ WORKOS_API_KEY: 'sk_test' }, { integration, options });

    expect(readFile).toHaveBeenCalledWith(join(options.installDir, '.env.local'), 'utf8');
    expect(uploadEnvVars).toHaveBeenCalledWith({
      WORKOS_API_KEY: 'sk_test',
      WORKOS_COOKIE_PASSWORD: 'test-password',
      NEXT_PUBLIC_WORKOS_REDIRECT_URI: redirectUri,
    });
    expect(result).toEqual(['WORKOS_API_KEY', 'WORKOS_COOKIE_PASSWORD', 'NEXT_PUBLIC_WORKOS_REDIRECT_URI']);
  });
});

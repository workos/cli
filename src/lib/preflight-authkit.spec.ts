import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliExit } from '../utils/cli-exit.js';
import { resetInteractionModeForTests, setInteractionMode } from '../utils/interaction-mode.js';
import { setOutputMode } from '../utils/output.js';

// Mock the UI facade — the interactive branch prompts, which has no place in a unit test.
const mockConfirm = vi.fn();
const mockUi = {
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), step: vi.fn(), success: vi.fn() },
  rows: vi.fn(),
  confirm: (...args: unknown[]) => mockConfirm(...args),
  // Mirrors the real facade: only the CANCEL symbol counts as a cancellation.
  isCancel: (value: unknown) => typeof value === 'symbol',
};
vi.mock('../utils/ui.js', () => ({ default: mockUi }));

const { assertNoExistingAuthKit, detectExistingAuthKit } = await import('./preflight-authkit.js');

function writePackageJson(dir: string, deps: Record<string, string>, devDeps?: Record<string, string>): void {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', dependencies: deps, devDependencies: devDeps ?? {} }),
  );
}

describe('preflight-authkit', () => {
  let testDir: string;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'preflight-authkit-test-'));
    vi.clearAllMocks();
    resetInteractionModeForTests();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    resetInteractionModeForTests();
    setOutputMode('human');
    errorSpy.mockRestore();
  });

  describe('detectExistingAuthKit', () => {
    it('returns [] when the project has no package.json', () => {
      expect(detectExistingAuthKit(testDir)).toEqual([]);
    });

    it('returns [] when package.json is malformed (parse failure must not block a run)', () => {
      writeFileSync(join(testDir, 'package.json'), '{ not json');

      expect(detectExistingAuthKit(testDir)).toEqual([]);
    });

    it('returns [] for a framework project with no WorkOS packages', () => {
      writePackageJson(testDir, { next: '15.0.0', react: '19.0.0' });

      expect(detectExistingAuthKit(testDir)).toEqual([]);
    });

    it('detects an installed AuthKit SDK with its version range', () => {
      writePackageJson(testDir, { next: '15.0.0', '@workos-inc/authkit-nextjs': '^2.6.0' });

      expect(detectExistingAuthKit(testDir)).toEqual([{ name: '@workos-inc/authkit-nextjs', version: '^2.6.0' }]);
    });

    it('detects AuthKit declared as a devDependency', () => {
      writePackageJson(testDir, { next: '15.0.0' }, { '@workos-inc/authkit-js': '1.0.0' });

      expect(detectExistingAuthKit(testDir)).toEqual([{ name: '@workos-inc/authkit-js', version: '1.0.0' }]);
    });

    // False-positive guard: the base SDK is in plenty of projects that have
    // never installed AuthKit, and those must stay installable.
    it('does NOT trip on @workos-inc/node alone', () => {
      writePackageJson(testDir, { '@workos-inc/node': '^7.0.0' });

      expect(detectExistingAuthKit(testDir)).toEqual([]);
    });

    it('does NOT trip on the legacy workos package alone', () => {
      writePackageJson(testDir, { workos: '^4.0.0' });

      expect(detectExistingAuthKit(testDir)).toEqual([]);
    });

    it('ignores @workos-inc/node when it sits alongside AuthKit', () => {
      writePackageJson(testDir, { '@workos-inc/authkit-nextjs': '^2.6.0', '@workos-inc/node': '^7.0.0' });

      expect(detectExistingAuthKit(testDir)).toEqual([{ name: '@workos-inc/authkit-nextjs', version: '^2.6.0' }]);
    });

    it('lists every AuthKit SDK found, not just the first', () => {
      writePackageJson(testDir, { '@workos-inc/authkit-nextjs': '^2.6.0', '@workos-inc/authkit-react': '^1.2.0' });

      expect(detectExistingAuthKit(testDir)).toEqual([
        { name: '@workos-inc/authkit-nextjs', version: '^2.6.0' },
        { name: '@workos-inc/authkit-react', version: '^1.2.0' },
      ]);
    });
  });

  describe('assertNoExistingAuthKit', () => {
    it('is a no-op when no AuthKit is present', async () => {
      writePackageJson(testDir, { next: '15.0.0' });

      await expect(assertNoExistingAuthKit({ installDir: testDir })).resolves.toBeUndefined();
      expect(mockConfirm).not.toHaveBeenCalled();
    });

    it('throws CliExit (exit 1) naming the packages and doctor in non-interactive mode', async () => {
      writePackageJson(testDir, { '@workos-inc/authkit-nextjs': '^2.6.0' });
      setInteractionMode({ mode: 'agent', source: 'env' });

      const error = await assertNoExistingAuthKit({ installDir: testDir }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CliExit);
      const exit = error as InstanceType<typeof CliExit>;
      expect(exit.exitCode).toBe(1);
      expect(exit.context?.errorCode).toBe('authkit_already_installed');
      expect(exit.context?.reason).toBe('validation_error');

      const printed = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(printed).toContain('@workos-inc/authkit-nextjs ^2.6.0');
      expect(printed).toContain('doctor');
      expect(printed).toContain('--force');
      // Never prompt in a non-interactive session.
      expect(mockConfirm).not.toHaveBeenCalled();
    });

    // --json on a real TTY: output mode is json while interaction mode stays
    // human, so isPromptAllowed() alone is not enough of a gate. Prompting here
    // would put plain text in the JSON stream and report prompt_unavailable.
    it('refuses without prompting or printing under --json on a TTY (interaction mode human)', async () => {
      writePackageJson(testDir, { '@workos-inc/authkit-nextjs': '^2.6.0' });
      setInteractionMode({ mode: 'human', source: 'default' });
      setOutputMode('json');

      const error = await assertNoExistingAuthKit({ installDir: testDir }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CliExit);
      expect((error as InstanceType<typeof CliExit>).context?.errorCode).toBe('authkit_already_installed');
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockUi.log.warn).not.toHaveBeenCalled();
      expect(mockUi.log.info).not.toHaveBeenCalled();
      expect(mockUi.rows).not.toHaveBeenCalled();
    });

    it('also refuses in CI mode', async () => {
      writePackageJson(testDir, { '@workos-inc/authkit-remix': '^1.0.0' });
      setInteractionMode({ mode: 'ci', source: 'ci_env' });

      await expect(assertNoExistingAuthKit({ installDir: testDir })).rejects.toBeInstanceOf(CliExit);
    });

    it('returns without throwing when force is set in non-interactive mode', async () => {
      writePackageJson(testDir, { '@workos-inc/authkit-nextjs': '^2.6.0' });
      setInteractionMode({ mode: 'agent', source: 'env' });

      await expect(assertNoExistingAuthKit({ installDir: testDir, force: true })).resolves.toBeUndefined();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('does not even read package.json when force is set', async () => {
      // force short-circuits before detection, so a malformed manifest is irrelevant.
      writeFileSync(join(testDir, 'package.json'), '{ not json');

      await expect(assertNoExistingAuthKit({ installDir: testDir, force: true })).resolves.toBeUndefined();
    });

    it('returns normally when an interactive user accepts', async () => {
      writePackageJson(testDir, { '@workos-inc/authkit-nextjs': '^2.6.0' });
      mockConfirm.mockResolvedValueOnce(true);

      await expect(assertNoExistingAuthKit({ installDir: testDir })).resolves.toBeUndefined();
      expect(mockConfirm).toHaveBeenCalledTimes(1);
      expect(mockUi.log.warn).toHaveBeenCalledWith(expect.stringContaining('already installed'));
      expect(mockUi.rows).toHaveBeenCalledWith([
        { key: '@workos-inc/authkit-nextjs', value: '^2.6.0', statusKind: 'muted' },
      ]);
      // Names the exact file at risk — .env.local here, since package.json exists.
      expect(mockUi.log.info).toHaveBeenCalledWith(expect.stringContaining(join(testDir, '.env.local')));
    });

    // The consent copy must not promise an outcome that cannot happen: with a key
    // already on disk, credential resolution refuses to provision and logs in.
    it('promises credentials will be KEPT (not rewritten) when the project env already has a key', async () => {
      writePackageJson(testDir, { '@workos-inc/authkit-nextjs': '^2.6.0' });
      writeFileSync(join(testDir, '.env.local'), 'WORKOS_API_KEY=sk_existing\n');
      mockConfirm.mockResolvedValueOnce(true);

      await expect(assertNoExistingAuthKit({ installDir: testDir })).resolves.toBeUndefined();

      const printed = mockUi.log.info.mock.calls.map((call) => String(call[0])).join('\n');
      expect(printed).toContain('will be kept');
      expect(printed).not.toContain('provision a new WorkOS environment');
    });

    it('names the file the key actually lives in, even when it is not the write target', async () => {
      writePackageJson(testDir, { '@workos-inc/authkit-nextjs': '^2.6.0' });
      // JS project, so the write target is .env.local — but the real key is in .env.
      writeFileSync(join(testDir, '.env'), 'WORKOS_API_KEY=sk_existing\n');
      mockConfirm.mockResolvedValueOnce(true);

      await expect(assertNoExistingAuthKit({ installDir: testDir })).resolves.toBeUndefined();

      const printed = mockUi.log.info.mock.calls.map((call) => String(call[0])).join('\n');
      expect(printed).toContain(join(testDir, '.env'));
      expect(printed).not.toContain(join(testDir, '.env.local'));
    });

    it('throws CliExit (exit 2) and writes nothing when an interactive user declines', async () => {
      writePackageJson(testDir, { '@workos-inc/authkit-nextjs': '^2.6.0' });
      mockConfirm.mockResolvedValueOnce(false);

      const error = await assertNoExistingAuthKit({ installDir: testDir }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CliExit);
      const exit = error as InstanceType<typeof CliExit>;
      expect(exit.exitCode).toBe(2);
      expect(exit.context?.reason).toBe('cancelled');
      // No env file, no .gitignore — the guard runs before anything is written.
      expect(readdirSync(testDir)).toEqual(['package.json']);
    });

    it('throws CliExit (exit 2) when the prompt is cancelled', async () => {
      writePackageJson(testDir, { '@workos-inc/authkit-nextjs': '^2.6.0' });
      mockConfirm.mockResolvedValueOnce(Symbol('workos.prompt.cancel'));

      const error = await assertNoExistingAuthKit({ installDir: testDir }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CliExit);
      expect((error as InstanceType<typeof CliExit>).exitCode).toBe(2);
    });
  });
});

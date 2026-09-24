import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectSingleIntegration, resolveAdapterKind, resolveCredentialSource } from './run-with-core.js';
import { setOutputMode } from '../utils/output.js';
import { resetInteractionModeForTests, setInteractionMode } from '../utils/interaction-mode.js';

describe('detectSingleIntegration', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'detect-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Regression guard: getPackageDotJson() calls process.exit(1) when package.json
  // is missing, which previously aborted the whole installer in Django projects
  // before Python detection ran.
  it('returns false for JS integrations when no package.json exists', async () => {
    await writeFile(join(dir, 'manage.py'), '# django');
    await writeFile(join(dir, 'requirements.txt'), 'django>=5.0\n');

    const result = await detectSingleIntegration('nextjs', { installDir: dir });
    expect(result).toBe(false);
  });

  it('detects python integration via pyproject.toml', async () => {
    await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\ndependencies = ["django>=5.0"]\n');

    const result = await detectSingleIntegration('python', { installDir: dir });
    expect(result).toBe(true);
  });

  it('detects python integration via manage.py alone', async () => {
    await writeFile(join(dir, 'manage.py'), '# django entrypoint');

    const result = await detectSingleIntegration('python', { installDir: dir });
    expect(result).toBe(true);
  });

  it('detects python integration via requirements.txt with django', async () => {
    await writeFile(join(dir, 'requirements.txt'), 'django>=5.0\n');

    const result = await detectSingleIntegration('python', { installDir: dir });
    expect(result).toBe(true);
  });

  it('does not detect python for a non-django python project', async () => {
    await writeFile(join(dir, 'requirements.txt'), 'flask>=3.0\n');

    const result = await detectSingleIntegration('python', { installDir: dir });
    expect(result).toBe(false);
  });

  it('detects dotnet via any *.csproj file (glob, not literal match)', async () => {
    await writeFile(join(dir, 'Example.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web" />\n');

    const result = await detectSingleIntegration('dotnet', { installDir: dir });
    expect(result).toBe(true);
  });

  it('detects kotlin via build.gradle (Groovy DSL), not just build.gradle.kts', async () => {
    await writeFile(join(dir, 'build.gradle'), "plugins { id 'org.jetbrains.kotlin.jvm' version '1.9.0' }\n");

    const result = await detectSingleIntegration('kotlin', { installDir: dir });
    expect(result).toBe(true);
  });

  it('detects kotlin via pom.xml (Maven)', async () => {
    await writeFile(join(dir, 'pom.xml'), '<project><dependencies><kotlin /></dependencies></project>\n');

    const result = await detectSingleIntegration('kotlin', { installDir: dir });
    expect(result).toBe(true);
  });
});

describe('resolveCredentialSource', () => {
  it("labels a fully backfilled pair 'env'", () => {
    // The provisioned unclaimed environment path: provisioning wrote the env
    // file before the machine started, so the user supplied neither value.
    const source = resolveCredentialSource(
      { credentialSource: 'cli' },
      { apiKey: 'sk_test_provisioned', clientId: 'client_provisioned' },
    );

    expect(source).toBe('env');
  });

  it('keeps the caller source when the user supplied both credentials', () => {
    const source = resolveCredentialSource(
      { apiKey: 'sk_test_flag', clientId: 'client_flag', credentialSource: 'cli' },
      { apiKey: 'sk_test_file', clientId: 'client_file' },
    );

    expect(source).toBe('cli');
  });

  // Regression guard: a mixed pair used to be labeled 'env' wholesale, which
  // made the installer announce `.env.local` as the origin of a credential the
  // user had typed on the command line.
  it('does not claim env provenance when only one credential was backfilled', () => {
    expect(
      resolveCredentialSource({ apiKey: 'sk_test_flag', credentialSource: 'cli' }, { clientId: 'client_file' }),
    ).toBe('cli');
    expect(
      resolveCredentialSource({ clientId: 'client_flag', credentialSource: 'cli' }, { apiKey: 'sk_test_file' }),
    ).toBe('cli');
  });

  it('leaves an unset caller source unset when there is nothing to backfill', () => {
    expect(resolveCredentialSource({}, {})).toBeUndefined();
  });
});

describe('resolveAdapterKind', () => {
  let saved: Array<[NodeJS.ReadStream | NodeJS.WriteStream, string, PropertyDescriptor | undefined]> = [];
  const originalTerm = process.env.TERM;

  function terminal(opts: { stdinTTY: boolean; stdoutTTY: boolean; columns: number; rows: number }) {
    const set = (stream: NodeJS.ReadStream | NodeJS.WriteStream, key: string, value: unknown) => {
      saved.push([stream, key, Object.getOwnPropertyDescriptor(stream, key)]);
      Object.defineProperty(stream, key, { value, configurable: true });
    };
    set(process.stdin, 'isTTY', opts.stdinTTY);
    set(process.stdout, 'isTTY', opts.stdoutTTY);
    set(process.stdout, 'columns', opts.columns);
    set(process.stdout, 'rows', opts.rows);
  }

  beforeEach(() => {
    saved = [];
    process.env.TERM = 'xterm-256color';
    resetInteractionModeForTests();
    setOutputMode('human');
  });

  afterEach(() => {
    for (const [stream, key, desc] of saved.reverse()) {
      if (desc) Object.defineProperty(stream, key, desc);
      else delete (stream as unknown as Record<string, unknown>)[key];
    }
    if (originalTerm === undefined) delete process.env.TERM;
    else process.env.TERM = originalTerm;
    resetInteractionModeForTests();
    setOutputMode('human');
  });

  // The full decision matrix is covered by select-adapter.spec.ts; these prove
  // runWithCore feeds it the real process state and flags.
  it('reads the terminal and flags from the running process', () => {
    terminal({ stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24 });
    expect(resolveAdapterKind({})).toBe('tui');
    expect(resolveAdapterKind({ noTui: true })).toBe('cli');
    terminal({ stdinTTY: true, stdoutTTY: true, columns: 79, rows: 24 });
    expect(resolveAdapterKind({})).toBe('cli');
  });

  it('reads the output and interaction modes', () => {
    terminal({ stdinTTY: true, stdoutTTY: true, columns: 120, rows: 40 });
    setInteractionMode({ mode: 'agent', source: 'flag' });
    expect(resolveAdapterKind({})).toBe('cli');
    setOutputMode('json');
    expect(resolveAdapterKind({})).toBe('headless');
  });
});

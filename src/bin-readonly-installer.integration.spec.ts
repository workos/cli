import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = join(root, 'src/test/readonly-installer.fixture.ts');
const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
let sandbox: string;
let project: string;
let env: NodeJS.ProcessEnv;
const git = (dir: string, ...args: string[]) => execFileSync(realGit, args, { cwd: dir, env, encoding: 'utf8' });

function repo(dir: string) {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'package.json'), '{"name":"offline-project","scripts":{"dev":"vite"}}');
  writeFileSync(join(dir, 'tracked.ts'), 'original\n');
  writeFileSync(join(dir, 'staged.ts'), 'original\n');
  writeFileSync(join(dir, '.gitignore'), '.env*\n');
  git(dir, 'add', '.');
  git(dir, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  writeFileSync(join(dir, 'staged.ts'), 'pre-existing staged work\n');
  git(dir, 'add', 'staged.ts');
  writeFileSync(join(dir, 'staged.ts'), 'pre-existing unstaged work\n');
  writeFileSync(join(dir, '.env.local'), 'WORKOS_API_KEY=sk_test_offline\nWORKOS_CLIENT_ID=client_offline\n');
}

beforeEach(() => {
  sandbox = mkdtempSync(join(root, '.auth6733-test-'));
  const home = join(sandbox, 'home');
  const bin = join(sandbox, 'bin');
  mkdirSync(home);
  mkdirSync(bin);
  env = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: home,
    TMP: home,
    TEMP: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Offline Test',
    GIT_AUTHOR_EMAIL: 'offline@example.test',
    GIT_COMMITTER_NAME: 'Offline Test',
    GIT_COMMITTER_EMAIL: 'offline@example.test',
    WORKOS_TELEMETRY: 'false',
    NO_COLOR: '1',
    TERM: 'dumb',
    TEST_EVIDENCE: join(sandbox, 'evidence.ndjson'),
    TEST_COMMANDS: join(sandbox, 'commands.log'),
  };
  writeFileSync(env.TEST_EVIDENCE!, '');
  writeFileSync(env.TEST_COMMANDS!, '');
  // Only read-only inspection and the explicitly preserved branch operation
  // can reach real git. Even a swallowed forbidden error leaves evidence.
  writeFileSync(
    join(bin, 'git'),
    `#!/bin/sh\nprintf '%s\\n' "git $*" >> "$TEST_COMMANDS"\ncase "$1" in\n rev-parse|status|checkout) exec '${realGit}' "$@" ;;\n *) echo FORBIDDEN >> "$TEST_COMMANDS"; exit 97 ;;\nesac\n`,
    { mode: 0o755 },
  );
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\necho "FORBIDDEN gh $*" >> "$TEST_COMMANDS"\nexit 97\n', { mode: 0o755 });
  project = join(sandbox, 'project');
  repo(project);
});

afterEach(() => rmSync(sandbox, { recursive: true, force: true }));

function run(args: string[], overrides: NodeJS.ProcessEnv = {}, cwd = project) {
  const head = git(project, 'rev-parse', 'HEAD');
  const index = git(project, 'ls-files', '--stage');
  const result = spawnSync('bun', [fixture, ...args], {
    cwd,
    env: { ...env, ...overrides },
    encoding: 'utf8',
    timeout: 20_000,
  });
  expect(result.error).toBeUndefined();
  const evidence = readFileSync(env.TEST_EVIDENCE!, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((s) => JSON.parse(s));
  expect(evidence.filter((e) => e.kind === 'forbidden')).toEqual([]);
  expect(readFileSync(env.TEST_COMMANDS!, 'utf8')).not.toContain('FORBIDDEN');
  expect(git(project, 'rev-parse', 'HEAD')).toBe(head);
  // Git status can refresh stat metadata, but never the staged entries.
  expect(git(project, 'ls-files', '--stage')).toBe(index);
  expect(git(project, 'show', ':staged.ts')).toBe('pre-existing staged work\n');
  expect(git(project, 'diff', '--cached', '--name-only')).toBe('staged.ts\n');
  return { ...result, evidence, index };
}

const install = [
  'install',
  '--skip-auth',
  '--api-key',
  'sk_test_offline',
  '--client-id',
  'client_offline',
  '--no-git-check',
  '--no-branch',
];
const events = (stdout: string) =>
  stdout
    .trim()
    .split('\n')
    .map((s) => JSON.parse(s));

function expectSuccess(result: ReturnType<typeof run>) {
  expect(result.status, result.stderr + result.stdout).toBe(0);
  const complete = events(result.stdout).find((e) => e.type === 'complete');
  expect(complete.success).toBe(true);
  expect(complete.files).toEqual(expect.arrayContaining(['generated.ts', 'tracked.ts', 'staged.ts']));
  expect(complete.changeDetection.state).toBe('changed');
  expect(complete.applicationSetup.reason).toContain('Offline fixture');
  expect(complete.nextSteps.join(' ')).toContain('uncommitted');
  expect(events(result.stdout).some((e) => e.type === 'validation:complete')).toBe(true);
  expect(events(result.stdout).some((e) => /commit:|pr:|push:/.test(e.type))).toBe(false);
  expect(git(project, 'status', '--porcelain')).toContain('?? generated.ts');
  expect(git(project, 'diff', '--name-only')).toContain('tracked.ts');
}

describe('installer leaves changes uncommitted through the real parser and orchestrator', () => {
  it.each(
    [
      [],
      ['--commit'],
      ['--no-commit'],
      ['--commit=true'],
      ['--commit=false'],
      ['--create-pr'],
      ['--create-pr=true'],
      ['--create-pr=false'],
      ['--no-create-pr'],
      ['--commit', 'false', '--create-pr', 'false'],
      ['--direct', '--commit', '--create-pr'],
      ['--commit', '--no-commit', '--create-pr'],
      ['--no-commit', '--commit', '--no-create-pr'],
    ].map((flags) => ({ flags })),
  )('accepts legacy forms $flags without publication or model calls (JSON)', ({ flags }) => {
    const result = run([...install, ...flags, '--json']);
    expectSuccess(result);
    expect(result.stderr).toBe('');
    // Normalization drops obsolete controls entirely, including omitted flags.
    expect(result.evidence.find((e) => e.kind === 'agent-options').value).toEqual({ installDir: project });
    expect(git(project, 'branch', '--show-current')).toBe('main\n');
  });

  it('documents compatibility-only flags without active defaults in human and machine help', () => {
    const human = run(['install', '--help'], { TEST_HUMAN: '1' });
    expect(human.status).toBe(0);
    expect(human.stdout).toContain('Deprecated no-op');
    expect(human.stdout).not.toContain('Auto-commit');
    const machine = run(['install', '--help', '--json']);
    expect(machine.status).toBe(0);
    const options = JSON.parse(machine.stdout).options;
    for (const name of ['commit', 'create-pr']) {
      const option = options.find((o: { name: string }) => o.name === name);
      expect(option.description).toContain('Deprecated no-op');
      expect(option).not.toHaveProperty('default');
    }
    expect(machine.stderr).toBe('');
  });

  it('CI completes on a dirty tree and preserves automatic branch creation', () => {
    const result = run(
      [
        'install',
        '--api-key',
        'sk_test_offline',
        '--client-id',
        'client_offline',
        '--install-dir',
        project,
        '--create-pr',
      ],
      { WORKOS_MODE: 'ci' },
    );
    expectSuccess(result);
    expect(result.stderr).toBe('');
    expect(git(project, 'branch', '--show-current')).toBe('feat/add-workos-authkit\n');
  });

  it('runtime/programmatic legacy values cannot revive removed actions', () => {
    expectSuccess(run([], { TEST_ENTRY: 'programmatic' }));
  });

  it.each(['install', 'default'])('human %s path finishes with only pre-install prompts', (entry) => {
    const result = run(entry === 'install' ? ['install', '--commit', '--create-pr'] : ['--no-commit', '--create-pr'], {
      TEST_HUMAN: '1',
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout + result.stderr).toContain('Deprecated installer Git flags are ignored');
    expect(result.stdout).toContain('The installer leaves changes uncommitted');
    expect(result.evidence.filter((e) => e.kind === 'prompt').map((e) => e.value)).toEqual(
      entry === 'default'
        ? ['Run the AuthKit installer?', 'Continue anyway?', 'You are on main. Create a feature branch?']
        : ['Continue anyway?', 'You are on main. Create a feature branch?'],
    );
    expect(git(project, 'branch', '--show-current')).toBe('feat/add-workos-authkit\n');
  });

  it('does not warn when legacy options are omitted in human mode', () => {
    const result = run(install, { TEST_HUMAN: '1' });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout + result.stderr).not.toContain('Deprecated installer Git flags');
    // Preserve the existing limitation: human CLI still asks the branch question
    // with --no-branch; only the headless adapter consumes that option today.
    expect(result.evidence.filter((e) => e.kind === 'prompt').map((e) => e.value)).toContain(
      'You are on main. Create a feature branch?',
    );
    expect(git(project, 'branch', '--show-current')).toBe('feat/add-workos-authkit\n');
  });

  it('reports installDir instead of the different repository in process cwd', () => {
    const other = join(sandbox, 'other');
    repo(other);
    writeFileSync(join(other, 'wrong-repository.txt'), 'not the target');
    const result = run([...install, '--install-dir', project, '--json'], {}, other);
    expectSuccess(result);
    const output = events(result.stdout);
    expect(output.find((e) => e.type === 'postinstall:changes').files).not.toContain('wrong-repository.txt');
    expect(output.find((e) => e.type === 'complete').files).not.toContain('wrong-repository.txt');
    // Existing pre-install policy is intentionally unchanged in this ticket:
    // its dirty-tree check still inspects process cwd, unlike post-install.
    expect(output.find((e) => e.type === 'git:status').files).toContain('- wrong-repository.txt');
  });

  it('reports fake agent failure without post-install success or publication', () => {
    const result = run([...install, '--create-pr', '--json'], { TEST_AGENT: 'fail' });
    expect(result.status).toBe(1);
    expect(
      events(result.stdout)
        .filter((e) => e.type === 'complete')
        .every((e) => e.success === false),
    ).toBe(true);
    expect(result.stdout).not.toContain('postinstall:');
    expect(JSON.parse(result.stderr).error.message).toContain('Fake installation failed');
  });

  it('cancels before the agent without asking any post-install questions', () => {
    git(project, 'checkout', '-qb', 'existing-feature');
    const result = run(['install', '--no-branch', '--create-pr'], { TEST_HUMAN: '1', TEST_CANCEL: '1' });
    expect(result.stdout).toContain('cancelled');
    expect(result.evidence.some((e) => e.kind === 'agent-options')).toBe(false);
    expect(result.evidence.filter((e) => e.kind === 'prompt').map((e) => e.value)).toEqual(['Continue anyway?']);
  });
});

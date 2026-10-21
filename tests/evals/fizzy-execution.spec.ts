import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ParallelRunner } from './parallel-runner.js';
import { runEvals } from './runner.js';
import { FixtureManager } from './fixture-manager.js';
import { prepareFizzyFixture, bootstrapFizzy } from './fizzy-fixture.js';
import { AgentExecutor } from './agent-executor.js';
import { loadCredentials } from './env-loader.js';
import { QualityGrader } from './graders/quality-grader.js';
import { collectKeyFiles } from './graders/collect-key-files.js';
import { FizzyGrader } from './graders/fizzy.grader.js';

const { agentRun, qualityGrade } = vi.hoisted(() => ({ agentRun: vi.fn(), qualityGrade: vi.fn() }));
vi.mock('./agent-executor.js', () => ({
  AgentExecutor: vi.fn(
    class {
      run = agentRun;
    },
  ),
}));
vi.mock('./fizzy-fixture.js', async (original) => ({
  ...(await original<typeof import('./fizzy-fixture.js')>()),
  prepareFizzyFixture: vi.fn(async (root: string) => {
    const app = join(root, 'app');
    await mkdir(app);
    return app;
  }),
  bootstrapFizzy: vi.fn(async () => {}),
}));
vi.mock('./env-loader.js', () => ({ loadCredentials: vi.fn(() => ({ anthropicApiKey: 'synthetic-only' })) }));
vi.mock('./graders/quality-grader.js', () => ({
  QualityGrader: vi.fn(
    class {
      grade = qualityGrade;
    },
  ),
}));
vi.mock('./graders/collect-key-files.js', () => ({
  collectKeyFiles: vi.fn(async () => new Map([['app.rb', 'synthetic source']])),
}));
vi.mock('./versioning.js', () => ({
  captureVersionMetadata: vi.fn(async () => ({
    skillVersions: {},
    cliVersion: 'synthetic',
    modelVersion: 'not-executed',
  })),
}));
vi.mock('./history.js', () => ({ saveResults: vi.fn(async () => 'synthetic-results') }));
vi.mock('./log-writer.js', () => ({
  LogWriter: class {
    getFilePath() {
      return 'synthetic-log';
    }
    cleanup() {}
  },
}));

const fizzy = { framework: 'ruby', state: 'fizzy', grader: FizzyGrader };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('FIZZY_APPROVED_RUN', '1');
  vi.stubEnv('FIZZY_ARCHIVE', '/synthetic/pinned-archive');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Network forbidden');
    }),
  );
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process, 'on').mockReturnValue(process);
  agentRun.mockResolvedValue({
    success: true,
    output: 'Synthetic agent finished',
    toolCalls: [],
    correctionAttempts: 0,
    selfCorrected: false,
  });
  qualityGrade.mockResolvedValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function expectSingleAttempt() {
  expect(prepareFizzyFixture).toHaveBeenCalledOnce();
  expect(bootstrapFizzy).toHaveBeenCalledOnce();
  expect(AgentExecutor).toHaveBeenCalledOnce();
  expect(agentRun).toHaveBeenCalledExactlyOnceWith({ enabled: false, maxRetries: 0 });
  expect(vi.mocked(bootstrapFizzy).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(AgentExecutor).mock.invocationCallOrder[0],
  );
  expect(loadCredentials).not.toHaveBeenCalled();
  expect(QualityGrader).not.toHaveBeenCalled();
  expect(qualityGrade).not.toHaveBeenCalled();
  expect(collectKeyFiles).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
}

it.each([undefined, 0, 5, -1, NaN])('caps runEvals with retry=%s and quality/correction overrides', async (retry) => {
  const results = await runEvals({
    framework: ['ruby'],
    state: 'fizzy',
    retry,
    noCorrection: false,
    quality: true,
    noFail: true,
  });
  expect(results[0]).toMatchObject({ scenario: 'ruby/fizzy', passed: false, attempts: 1 });
  expect(results[0].checks?.some((check) => check.message?.includes('UNVERIFIED'))).toBe(true);
  expectSingleAttempt();
});

it.each([1, 3, 9, 0, -1, NaN, Infinity, 1.5])('caps direct ParallelRunner maxAttempts=%s', async (maxAttempts) => {
  const results = await new ParallelRunner([fizzy], { maxAttempts, concurrency: 1, noCorrection: false }).run();
  expect(results[0]).toMatchObject({ passed: false, attempts: 1 });
  expectSingleAttempt();
});

it.each(['FIZZY_APPROVED_RUN', 'FIZZY_ARCHIVE'])(
  'refuses before preparation/bootstrap/agent/quality when %s is missing',
  async (key) => {
    vi.stubEnv(key, '');
    const results = await runEvals({ framework: ['ruby'], state: 'fizzy', quality: true, retry: 4, noFail: true });
    expect(results[0]).toMatchObject({
      passed: false,
      attempts: 1,
      error: expect.stringContaining('explicit spending/policy approval'),
    });
    expect(prepareFizzyFixture).not.toHaveBeenCalled();
    expect(bootstrapFizzy).not.toHaveBeenCalled();
    expect(AgentExecutor).not.toHaveBeenCalled();
    expect(loadCredentials).not.toHaveBeenCalled();
    expect(QualityGrader).not.toHaveBeenCalled();
  },
);

it('does not construct an agent or retry when bootstrap preflight refuses', async () => {
  vi.mocked(bootstrapFizzy).mockRejectedValueOnce(new Error('Fizzy source/runtime prerequisites unavailable'));
  const results = await new ParallelRunner([fizzy], { maxAttempts: 3, concurrency: 1 }).run();
  expect(results[0]).toMatchObject({
    passed: false,
    attempts: 1,
    error: expect.stringContaining('prerequisites unavailable'),
  });
  expect(prepareFizzyFixture).toHaveBeenCalledOnce();
  expect(bootstrapFizzy).toHaveBeenCalledOnce();
  expect(AgentExecutor).not.toHaveBeenCalled();
});

it.each([false, true])('preserves retries/correction for other scenarios (noCorrection=%s)', async (noCorrection) => {
  vi.spyOn(FixtureManager.prototype, 'setup').mockResolvedValue('/synthetic/app');
  const grader = class {
    async grade() {
      return { passed: false, checks: [] };
    }
  };
  const results = await new ParallelRunner([{ framework: 'ruby', state: 'example', grader }], {
    maxAttempts: 3,
    concurrency: 1,
    noCorrection,
  }).run();
  expect(results[0]).toMatchObject({ passed: false, attempts: 3 });
  expect(agentRun).toHaveBeenCalledTimes(3);
  for (const [config] of agentRun.mock.calls)
    expect(config).toEqual(noCorrection ? { enabled: false, maxRetries: 0 } : undefined);
});

it('never collects Fizzy quality inputs even with an overridden passing grader', async () => {
  const grader = class {
    async grade() {
      return { passed: true, checks: [] };
    }
  };
  await new ParallelRunner([{ ...fizzy, grader }], { maxAttempts: 3, concurrency: 1 }).run();
  expectSingleAttempt();
});

it.each(['ruby/fizzy', 'ruby/example'])('quality eligibility is enforced again for result %s', async (scenario) => {
  vi.spyOn(ParallelRunner.prototype, 'run').mockResolvedValue([
    { scenario, passed: true, duration: 1, keyFiles: new Map([['app.rb', 'synthetic source']]) },
  ]);
  await runEvals({ framework: ['ruby'], state: scenario.split('/')[1], quality: true, noFail: true });
  expect(qualityGrade).toHaveBeenCalledTimes(scenario === 'ruby/fizzy' ? 0 : 1);
  expect(loadCredentials).toHaveBeenCalledTimes(scenario === 'ruby/fizzy' ? 0 : 1);
});

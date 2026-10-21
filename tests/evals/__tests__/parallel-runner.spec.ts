import { afterEach, expect, it, vi } from 'vitest';
import { ParallelRunner } from '../parallel-runner.js';
import { evalEvents } from '../events.js';
import { AgentExecutor } from '../agent-executor.js';

vi.mock('../agent-executor.js', () => ({ AgentExecutor: vi.fn() }));
vi.mock('../fixture-manager.js', () => ({
  FixtureManager: vi.fn(function FixtureManager() {
    return {
      setup: vi.fn(async () => '/tmp/fixture'),
      cleanup: vi.fn(async () => {}),
      getTempDir: () => '/tmp/fixture',
    };
  }),
}));
vi.mock('../graders/collect-key-files.js', () => ({ collectKeyFiles: vi.fn(async () => undefined) }));

afterEach(() => vi.restoreAllMocks());

it('completes a run without scheduling unused dashboard progress updates', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  // Keep the runner's process-wide shutdown handlers out of the test process.
  vi.spyOn(process, 'on').mockReturnValue(process);
  const interval = vi.spyOn(globalThis, 'setInterval');
  const completed = vi.spyOn(evalEvents, 'emitRunComplete');
  const runner = new ParallelRunner([], { maxAttempts: 1, concurrency: 1 });

  await expect(runner.run()).resolves.toEqual([]);

  expect(interval).not.toHaveBeenCalled();
  expect(completed).toHaveBeenCalledOnce();
});

it('fails a scenario when the installer fails even if the grader passes', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process, 'on').mockReturnValue(process);
  vi.mocked(AgentExecutor).mockImplementation(function () {
    return {
      run: vi.fn(async () => ({
        success: false,
        error: 'Installation validation failed: missing /sign-in route',
        output: '',
        toolCalls: [],
        correctionAttempts: 0,
        selfCorrected: false,
      })),
    } as unknown as AgentExecutor;
  });
  class PassingGrader {
    async grade() {
      return { passed: true, checks: [{ name: 'Build', passed: true }] };
    }
  }
  const runner = new ParallelRunner([{ framework: 'nextjs', state: 'example', grader: PassingGrader }], {
    maxAttempts: 1,
    concurrency: 1,
  });

  const [result] = await runner.run();

  expect(result.passed).toBe(false);
  expect(result.error).toContain('missing /sign-in route');
  expect(result.checks?.[0]).toMatchObject({ name: 'Installer completed', passed: false });
});

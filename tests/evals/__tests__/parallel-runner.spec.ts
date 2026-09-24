import { afterEach, expect, it, vi } from 'vitest';
import { ParallelRunner } from '../parallel-runner.js';
import { evalEvents } from '../events.js';

vi.mock('../agent-executor.js', () => ({ AgentExecutor: vi.fn() }));

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

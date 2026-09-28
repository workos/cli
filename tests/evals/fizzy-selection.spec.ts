import { expect, it, vi } from 'vitest';
import { selectScenarios } from './runner.js';
import { parseArgs } from './cli.js';

vi.mock('./env-loader.js', () => ({
  loadCredentials: () => {
    throw new Error('No credential loading during selection');
  },
}));
vi.mock('./agent-executor.js', () => ({
  AgentExecutor: class {
    constructor() {
      throw new Error('No paid executor during selection');
    }
  },
}));

it('never expands the default or Ruby paid sweep with Fizzy', () => {
  for (const options of [{}, { framework: ['ruby'] }, { state: 'fizzy' }]) {
    expect(selectScenarios(options).some((scenario) => scenario.state === 'fizzy')).toBe(false);
  }
});
it('selects exactly one real-world scenario with explicit flags', () => {
  const options = parseArgs(['--framework=ruby', '--state=fizzy', '--retry=0', '--sequential', '--no-correction']);
  expect(options.retry).toBe(0);
  expect(options.sequential).toBe(true);
  expect(options.noCorrection).toBe(true);
  expect(selectScenarios(options)).toEqual([
    expect.objectContaining({ framework: 'ruby', state: 'fizzy', optIn: true }),
  ]);
});

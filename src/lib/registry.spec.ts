import { describe, expect, it } from 'vitest';
import { buildRegistry } from './registry.js';

const EXPECTED_INTEGRATIONS = [
  'dotnet',
  'elixir',
  'go',
  'kotlin',
  'nextjs',
  'node',
  'php',
  'php-laravel',
  'python',
  'react',
  'react-router',
  'ruby',
  'sveltekit',
  'tanstack-start',
  'vanilla-js',
];

describe('integration registry', () => {
  it('contains every statically generated integration', async () => {
    const registry = await buildRegistry();
    expect(
      registry
        .all()
        .map((config) => config.metadata.integration)
        .sort(),
    ).toEqual(EXPECTED_INTEGRATIONS);
    for (const name of EXPECTED_INTEGRATIONS) expect(registry.get(name)?.run).toBeTypeOf('function');
  });
});

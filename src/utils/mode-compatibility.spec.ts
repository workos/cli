/**
 * Backcompat matrix tests for Phase 6.
 *
 * Encodes the contract's commitment to resolving output mode and interaction mode
 * separately, then coercing the effective output mode to JSON for explicit
 * agent/CI modes so headless streams are not prefixed by human-only output.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveEffectiveOutputMode, resolveOutputMode } from './output.js';
import { resolveInteractionMode } from './interaction-mode.js';

describe('mode compatibility matrix', () => {
  const originalEnv = process.env;
  const originalIsTTY = process.stdout.isTTY;
  const originalStderrIsTTY = process.stderr.isTTY;
  const interactionEnvKeys = ['WORKOS_MODE', 'WORKOS_NO_PROMPT', 'CI', 'GITHUB_ACTIONS', 'WORKOS_AGENT'] as const;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.WORKOS_FORCE_TTY;
    delete process.env.WORKOS_NO_PROMPT;
    delete process.env.WORKOS_MODE;
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    delete process.env.WORKOS_AGENT;
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true });
    Object.defineProperty(process.stderr, 'isTTY', { value: originalStderrIsTTY, writable: true });
    process.env = originalEnv;
  });

  function getInteractionTestEnv(): NodeJS.ProcessEnv {
    return Object.fromEntries(
      interactionEnvKeys.flatMap((key) => {
        const value = process.env[key];
        return value === undefined ? [] : [[key, value]];
      }),
    );
  }

  // Each row asserts that output and interaction modes resolve independently.
  type Row = {
    name: string;
    setup: () => { argv?: string[]; jsonFlag?: boolean };
    expectOutput: 'human' | 'json';
    expectMode: 'human' | 'agent' | 'ci';
    expectSource: 'flag' | 'env' | 'workos_no_prompt' | 'ci_env' | 'agent_env' | 'non_tty' | 'default';
  };

  const rows: Row[] = [
    {
      name: '--json alone keeps interaction mode at default human',
      setup: () => {
        Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
        Object.defineProperty(process.stderr, 'isTTY', { value: true, writable: true });
        return { jsonFlag: true };
      },
      expectOutput: 'json',
      expectMode: 'human',
      expectSource: 'default',
    },
    {
      name: 'non-TTY stdout maps output to json and interaction to agent',
      setup: () => {
        Object.defineProperty(process.stdout, 'isTTY', { value: undefined, writable: true });
        Object.defineProperty(process.stderr, 'isTTY', { value: undefined, writable: true });
        return {};
      },
      expectOutput: 'json',
      expectMode: 'agent',
      expectSource: 'non_tty',
    },
    {
      name: 'WORKOS_NO_PROMPT=1 maps output to json and interaction to agent (legacy compatibility)',
      setup: () => {
        Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
        Object.defineProperty(process.stderr, 'isTTY', { value: true, writable: true });
        process.env.WORKOS_NO_PROMPT = '1';
        return {};
      },
      expectOutput: 'json',
      expectMode: 'agent',
      expectSource: 'workos_no_prompt',
    },
    {
      name: 'WORKOS_FORCE_TTY=1 forces human output but does not change interaction mode (non-TTY)',
      setup: () => {
        Object.defineProperty(process.stdout, 'isTTY', { value: undefined, writable: true });
        Object.defineProperty(process.stderr, 'isTTY', { value: undefined, writable: true });
        process.env.WORKOS_FORCE_TTY = '1';
        return {};
      },
      expectOutput: 'human',
      // Interaction mode still resolves to agent because non-TTY is the only
      // remaining signal; WORKOS_FORCE_TTY must not silently flip interaction.
      expectMode: 'agent',
      expectSource: 'non_tty',
    },
    {
      name: 'WORKOS_MODE=human in non-TTY keeps interaction human but output stays json',
      setup: () => {
        Object.defineProperty(process.stdout, 'isTTY', { value: undefined, writable: true });
        Object.defineProperty(process.stderr, 'isTTY', { value: undefined, writable: true });
        process.env.WORKOS_MODE = 'human';
        return {};
      },
      expectOutput: 'json',
      expectMode: 'human',
      expectSource: 'env',
    },
    {
      name: 'WORKOS_MODE=agent with TTY coerces effective output to json',
      setup: () => {
        Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
        Object.defineProperty(process.stderr, 'isTTY', { value: true, writable: true });
        process.env.WORKOS_MODE = 'agent';
        return {};
      },
      expectOutput: 'json',
      expectMode: 'agent',
      expectSource: 'env',
    },
    {
      name: 'CI marker beats agent marker without explicit override',
      setup: () => {
        Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
        Object.defineProperty(process.stderr, 'isTTY', { value: true, writable: true });
        process.env.CI = 'true';
        process.env.WORKOS_AGENT = '1';
        return {};
      },
      expectOutput: 'json',
      expectMode: 'ci',
      expectSource: 'ci_env',
    },
    {
      name: '--mode agent beats CI markers',
      setup: () => {
        Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
        Object.defineProperty(process.stderr, 'isTTY', { value: true, writable: true });
        process.env.CI = 'true';
        process.env.GITHUB_ACTIONS = 'true';
        return { argv: ['--mode', 'agent'] };
      },
      expectOutput: 'json',
      expectMode: 'agent',
      expectSource: 'flag',
    },
  ];

  for (const row of rows) {
    it(row.name, () => {
      const { argv = [], jsonFlag } = row.setup();
      const interaction = resolveInteractionMode({ argv, env: getInteractionTestEnv() });
      expect(resolveEffectiveOutputMode(resolveOutputMode(jsonFlag), interaction)).toBe(row.expectOutput);
      expect(interaction).toEqual({
        mode: row.expectMode,
        source: row.expectSource,
      });
    });
  }
});

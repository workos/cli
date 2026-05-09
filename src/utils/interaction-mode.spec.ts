import { describe, it, expect, beforeEach } from 'vitest';
import {
  InvalidInteractionModeError,
  getInteractionMode,
  isAgentMode,
  isCiMode,
  isHumanMode,
  isPromptAllowed,
  resetInteractionModeForTests,
  resolveInteractionMode,
  setInteractionMode,
} from './interaction-mode.js';

describe('interaction-mode', () => {
  beforeEach(() => {
    resetInteractionModeForTests();
  });

  describe('resolveInteractionMode', () => {
    it('returns explicit --mode value from separate argv tokens', () => {
      expect(
        resolveInteractionMode({ argv: ['--mode', 'agent'], env: {}, stdoutIsTTY: true, stderrIsTTY: true }),
      ).toEqual({
        mode: 'agent',
        source: 'flag',
      });
    });

    it('returns explicit --mode value from equals syntax', () => {
      expect(resolveInteractionMode({ argv: ['--mode=ci'], env: {}, stdoutIsTTY: true, stderrIsTTY: true })).toEqual({
        mode: 'ci',
        source: 'flag',
      });
    });

    it('--mode beats WORKOS_MODE', () => {
      expect(
        resolveInteractionMode({
          argv: ['--mode', 'agent'],
          env: { WORKOS_MODE: 'ci' },
          stdoutIsTTY: true,
          stderrIsTTY: true,
        }),
      ).toEqual({ mode: 'agent', source: 'flag' });
    });

    it('WORKOS_MODE beats WORKOS_NO_PROMPT', () => {
      expect(
        resolveInteractionMode({
          env: { WORKOS_MODE: 'human', WORKOS_NO_PROMPT: '1' },
          stdoutIsTTY: false,
          stderrIsTTY: false,
        }),
      ).toEqual({ mode: 'human', source: 'env' });
    });

    it('WORKOS_NO_PROMPT=true maps to agent compatibility mode', () => {
      expect(
        resolveInteractionMode({ env: { WORKOS_NO_PROMPT: 'true' }, stdoutIsTTY: true, stderrIsTTY: true }),
      ).toEqual({
        mode: 'agent',
        source: 'workos_no_prompt',
      });
    });

    it('CI markers beat agent markers when no explicit mode is set', () => {
      expect(
        resolveInteractionMode({
          env: { CI: 'true', WORKOS_AGENT: '1' },
          stdoutIsTTY: true,
          stderrIsTTY: true,
        }),
      ).toEqual({ mode: 'ci', source: 'ci_env' });
    });

    it('detects agent markers', () => {
      expect(resolveInteractionMode({ env: { WORKOS_AGENT: '1' }, stdoutIsTTY: true, stderrIsTTY: true })).toEqual({
        mode: 'agent',
        source: 'agent_env',
      });
    });

    it('non-TTY maps to agent after env marker checks', () => {
      expect(resolveInteractionMode({ env: {}, stdoutIsTTY: false, stderrIsTTY: true })).toEqual({
        mode: 'agent',
        source: 'non_tty',
      });
    });

    it('TTY with no markers defaults to human', () => {
      expect(resolveInteractionMode({ env: {}, stdoutIsTTY: true, stderrIsTTY: true })).toEqual({
        mode: 'human',
        source: 'default',
      });
    });

    it('WORKOS_FORCE_TTY does not affect interaction mode', () => {
      expect(
        resolveInteractionMode({ env: { WORKOS_FORCE_TTY: '1' }, stdoutIsTTY: false, stderrIsTTY: false }),
      ).toEqual({
        mode: 'agent',
        source: 'non_tty',
      });
    });

    it('throws for invalid --mode values', () => {
      expect(() => resolveInteractionMode({ argv: ['--mode', 'robot'], env: {} })).toThrow(InvalidInteractionModeError);
    });

    it('throws for missing --mode values', () => {
      expect(() => resolveInteractionMode({ argv: ['--mode'], env: {} })).toThrow(InvalidInteractionModeError);
    });

    it('throws for invalid WORKOS_MODE values', () => {
      expect(() => resolveInteractionMode({ env: { WORKOS_MODE: 'robot' } })).toThrow(InvalidInteractionModeError);
    });
  });

  describe('process-level state', () => {
    it('sets and gets interaction mode', () => {
      setInteractionMode({ mode: 'agent', source: 'env' });
      expect(getInteractionMode()).toEqual({ mode: 'agent', source: 'env' });
      expect(isAgentMode()).toBe(true);
      expect(isHumanMode()).toBe(false);
      expect(isCiMode()).toBe(false);
      expect(isPromptAllowed()).toBe(false);
    });

    it('defaults to human mode', () => {
      expect(getInteractionMode()).toEqual({ mode: 'human', source: 'default' });
      expect(isHumanMode()).toBe(true);
      expect(isPromptAllowed()).toBe(true);
    });
  });
});

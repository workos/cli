import { describe, it, expect, beforeEach } from 'vitest';
import { isNonInteractiveEnvironment } from './environment.js';
import { resetInteractionModeForTests, setInteractionMode } from './interaction-mode.js';

describe('environment', () => {
  beforeEach(() => {
    resetInteractionModeForTests();
  });

  describe('isNonInteractiveEnvironment', () => {
    it('returns false in human interaction mode', () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      expect(isNonInteractiveEnvironment()).toBe(false);
    });

    it('returns true in agent interaction mode', () => {
      setInteractionMode({ mode: 'agent', source: 'workos_no_prompt' });
      expect(isNonInteractiveEnvironment()).toBe(true);
    });

    it('returns true in CI interaction mode', () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      expect(isNonInteractiveEnvironment()).toBe(true);
    });

    it('does not inspect WORKOS_FORCE_TTY directly', () => {
      process.env.WORKOS_FORCE_TTY = '1';
      setInteractionMode({ mode: 'agent', source: 'non_tty' });
      expect(isNonInteractiveEnvironment()).toBe(true);
      delete process.env.WORKOS_FORCE_TTY;
    });
  });
});

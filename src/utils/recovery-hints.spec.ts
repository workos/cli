import { describe, it, expect } from 'vitest';
import { authLoginRecovery, confirmationRecovery, missingArgsRecovery } from './recovery-hints.js';

describe('recovery-hints', () => {
  describe('authLoginRecovery', () => {
    it('CI mode prefers env credentials and marks login as host-shell-required', () => {
      const recovery = authLoginRecovery({ mode: 'ci', env: {} });
      expect(recovery.hints[0]).toMatchObject({
        description: expect.stringContaining('WORKOS_API_KEY'),
      });
      expect(recovery.hints[0].command).toBeUndefined();
      expect(recovery.hints[1]).toMatchObject({
        command: 'workos auth login',
        hostShellRequired: true,
      });
    });

    it('agent mode recommends host-shell login first and env var second', () => {
      const recovery = authLoginRecovery({ mode: 'agent', env: {} });
      expect(recovery.hints[0]).toMatchObject({
        command: 'workos auth login',
        hostShellRequired: true,
      });
      expect(recovery.hints[1].description).toMatch(/WORKOS_API_KEY/);
      expect(recovery.hints[1].command).toBeUndefined();
    });

    it('human mode recommends device login without host-shell flag', () => {
      const recovery = authLoginRecovery({ mode: 'human', env: {} });
      expect(recovery.hints[0]).toMatchObject({
        command: 'workos auth login',
      });
      expect(recovery.hints[0].hostShellRequired).toBeUndefined();
    });

    it('uses npx invocation when called via npm exec', () => {
      const recovery = authLoginRecovery({
        mode: 'agent',
        env: { npm_command: 'exec' },
      });
      expect(recovery.hints[0].command).toBe('npx workos@latest auth login');
    });
  });

  describe('confirmationRecovery', () => {
    it('returns a single deterministic command hint', () => {
      const recovery = confirmationRecovery('workos api /resource --method DELETE --yes');
      expect(recovery.hints).toHaveLength(1);
      expect(recovery.hints[0].command).toBe('workos api /resource --method DELETE --yes');
    });

    it('omits command when the rerun cannot be safely reconstructed', () => {
      const recovery = confirmationRecovery();
      expect(recovery.hints).toEqual([{ description: 'Re-run with explicit confirmation.' }]);
    });
  });

  describe('missingArgsRecovery', () => {
    it('attaches the example command and description', () => {
      const recovery = missingArgsRecovery('workos env add prod sk_test_xxx', 'Pass name and api key');
      expect(recovery.hints).toEqual([
        { description: 'Pass name and api key', command: 'workos env add prod sk_test_xxx' },
      ]);
    });

    it('omits placeholder commands', () => {
      const recovery = missingArgsRecovery(undefined, 'Pass name and api key');
      expect(recovery.hints).toEqual([{ description: 'Pass name and api key' }]);
    });
  });
});

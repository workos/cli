import { describe, expect, it, vi } from 'vitest';
import { runVerifyAssets } from './internal-verify-assets.js';

describe('runVerifyAssets', () => {
  // Exercises the real pipeline in source mode: skills materialize to a temp
  // dir and the Agent SDK `claude` executable is spawned with --version. In
  // the compiled binary the same code path additionally covers the first-run
  // download + checksum verification (verified by the CI smoke test).
  it('verifies embedded skills and the Agent SDK executable', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { setOutputMode } = await import('../utils/output.js');
    setOutputMode('json');
    try {
      await runVerifyAssets();

      const lastLine = logSpy.mock.calls.at(-1)?.[0] as string;
      const report = JSON.parse(lastLine);
      expect(report.ok).toBe(true);
      expect(report.skillCount).toBeGreaterThan(0);
      expect(report.bundledSkillsVersion).toMatch(/^\d+\.\d+\.\d+/);
      expect(report.agentSdkTarget).toBe(`${process.platform}-${process.arch}`);
      expect(report.keyring).toMatch(/^native/);
      expect(report.claudeVersion).toBeTruthy();
      expect(report.claudePath).not.toContain('$bunfs');
    } finally {
      setOutputMode('human');
      logSpy.mockRestore();
    }
  }, 120_000);
});

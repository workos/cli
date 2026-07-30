import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectIssues } from './issues.js';
import type { DoctorReport } from './types.js';

// getWorkOSCommand reads these; clear them so remediation copy is deterministic
// regardless of how the test runner itself was launched.
const NPM_KEYS = ['npm_command', 'npm_execpath', 'npm_config_user_agent'] as const;
let savedNpmEnv: Record<string, string | undefined>;
function clearNpmEnv(): void {
  savedNpmEnv = {};
  for (const k of NPM_KEYS) {
    savedNpmEnv[k] = process.env[k];
    delete process.env[k];
  }
}
function restoreNpmEnv(): void {
  for (const k of NPM_KEYS) {
    if (savedNpmEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedNpmEnv[k];
  }
}

function baseReport(): Omit<DoctorReport, 'issues' | 'summary'> {
  return {
    version: '1.0.0',
    timestamp: '2026-01-01T00:00:00.000Z',
    interactionMode: { mode: 'agent', source: 'env' },
    project: { path: '/tmp/app', packageManager: 'pnpm' },
    sdk: {
      name: '@workos-inc/node',
      version: '1.0.0',
      latest: '1.0.0',
      outdated: false,
      isAuthKit: false,
      language: 'javascript',
    },
    language: { name: 'JavaScript/TypeScript', manifestFile: 'package.json' },
    runtime: { nodeVersion: 'v22.0.0', packageManager: 'pnpm', packageManagerVersion: '10.0.0' },
    framework: { name: 'Next.js', version: '15.0.0' },
    environment: {
      apiKeyConfigured: true,
      apiKeyType: 'staging',
      clientId: 'client_123',
      redirectUri: 'http://localhost:3000/callback',
      cookieDomain: null,
      baseUrl: 'https://api.workos.com',
    },
    hostExecution: { mode: 'interactive', ok: true, failures: [] },
    connectivity: { apiReachable: true, latencyMs: 42, tlsValid: true },
  };
}

describe('detectIssues', () => {
  it('adds a warning when host execution is untrusted', () => {
    const report = baseReport();
    report.hostExecution = {
      mode: 'non-interactive',
      ok: false,
      warning: 'This may be a sandboxed run.',
      failures: [
        {
          capability: 'keychain',
          detail: 'EACCES: permission denied',
          operation: 'read',
          target: 'workos-cli/config',
          label: 'config keychain entry',
        },
      ],
    };

    const issues = detectIssues(report);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'HOST_EXECUTION_UNTRUSTED',
        severity: 'warning',
        remediation: expect.stringContaining('Agent/CI host execution is untrusted'),
        details: { failures: report.hostExecution.failures },
      }),
    );
  });

  describe('command hints in remediation route through formatWorkOSCommand', () => {
    beforeEach(clearNpmEnv);
    afterEach(restoreNpmEnv);

    function reportWithStaleSkills(): DoctorReport {
      const report = baseReport() as DoctorReport;
      report.skills = {
        bundledVersion: '2.0.0',
        agents: [{ agent: 'Claude Code', installedVersion: '1.0.0', stale: true }],
      };
      return report;
    }

    function reportWithMisconfiguredMcp(): DoctorReport {
      const report = baseReport() as DoctorReport;
      report.mcp = {
        serverUrl: 'https://mcp.workos.com/mcp',
        docsUrl: 'https://workos.com/docs/mcp',
        agents: [{ agent: 'Cursor', available: true, configured: true, installed: true, misconfigured: true }],
      };
      return report;
    }

    it('uses bare commands when not launched via npx', () => {
      const skills = detectIssues(reportWithStaleSkills()).find((i) => i.code === 'SKILLS_OUTDATED');
      expect(skills?.remediation).toBe('Run: workos skills install');

      const mcp = detectIssues(reportWithMisconfiguredMcp()).find((i) => i.code === 'MCP_MISCONFIGURED');
      expect(mcp?.remediation).toBe('Run: workos mcp install');
    });

    it('keeps the standalone binary form when npm variables are present', () => {
      process.env.npm_command = 'exec';

      const skills = detectIssues(reportWithStaleSkills()).find((i) => i.code === 'SKILLS_OUTDATED');
      expect(skills?.remediation).toBe('Run: workos skills install');

      const mcp = detectIssues(reportWithMisconfiguredMcp()).find((i) => i.code === 'MCP_MISCONFIGURED');
      expect(mcp?.remediation).toBe('Run: workos mcp install');
    });
  });

  describe('MCP', () => {
    beforeEach(clearNpmEnv);
    afterEach(restoreNpmEnv);

    it('adds no issue when MCP is absent or merely not configured', () => {
      const report = baseReport();
      // No mcp field at all.
      expect(detectIssues(report).some((i) => i.code === 'MCP_MISCONFIGURED')).toBe(false);

      // Detected agents, none misconfigured (some simply lack the server).
      report.mcp = {
        serverUrl: 'https://mcp.workos.com/mcp',
        docsUrl: 'https://workos.com/docs/mcp',
        agents: [
          { agent: 'Claude Code', available: true, configured: false, installed: false },
          { agent: 'Cursor', available: true, configured: true, installed: true, misconfigured: false },
        ],
      };
      expect(detectIssues(report).some((i) => i.code === 'MCP_MISCONFIGURED')).toBe(false);
    });

    it('adds exactly one warning listing the misconfigured agents', () => {
      const report = baseReport();
      report.mcp = {
        serverUrl: 'https://mcp.workos.com/mcp',
        docsUrl: 'https://workos.com/docs/mcp',
        agents: [
          { agent: 'Claude Code', available: true, configured: true, installed: true },
          { agent: 'Cursor', available: true, configured: true, installed: true, misconfigured: true },
        ],
      };

      const mcpIssues = detectIssues(report).filter((i) => i.code === 'MCP_MISCONFIGURED');

      expect(mcpIssues).toHaveLength(1);
      expect(mcpIssues[0]).toEqual(
        expect.objectContaining({
          code: 'MCP_MISCONFIGURED',
          severity: 'warning',
          message: expect.stringContaining('Cursor'),
          remediation: 'Run: workos mcp install',
        }),
      );
    });
  });
});

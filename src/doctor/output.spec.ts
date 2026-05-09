import { describe, it, expect, vi } from 'vitest';
import { formatInteractionModeSource, formatReport } from './output.js';
import type { DoctorReport } from './types.js';

function report(overrides: Partial<DoctorReport> = {}): DoctorReport {
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
    hostExecution: { mode: 'non-interactive', ok: true, failures: [] },
    connectivity: { apiReachable: true, latencyMs: 42, tlsValid: true },
    issues: [],
    summary: { errors: 0, warnings: 0, healthy: true },
    ...overrides,
  };
}

describe('doctor output', () => {
  it('formats interaction mode sources for human output', () => {
    expect(formatInteractionModeSource('flag')).toBe('--mode');
    expect(formatInteractionModeSource('env')).toBe('WORKOS_MODE');
    expect(formatInteractionModeSource('workos_no_prompt')).toBe('WORKOS_NO_PROMPT');
    expect(formatInteractionModeSource('ci_env')).toBe('CI environment');
    expect(formatInteractionModeSource('agent_env')).toBe('agent environment');
    expect(formatInteractionModeSource('non_tty')).toBe('non-TTY');
    expect(formatInteractionModeSource('default')).toBe('default');
  });

  it('shows interaction mode and source in human report output', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    formatReport(report());

    const output = log.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('Interaction Mode');
    expect(output).toContain('Mode:             agent (WORKOS_MODE)');
    expect(output).toContain('Agent/CI context, host state reachable');

    log.mockRestore();
  });

  it('shows agent/CI host trust warning summary without verbose mode', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    formatReport(
      report({
        hostExecution: {
          mode: 'non-interactive',
          ok: false,
          failures: [
            {
              capability: 'home-fs',
              detail: 'EACCES: permission denied',
              label: 'WorkOS home directory',
              target: '/Users/test/.workos',
            },
          ],
        },
      }),
    );

    const output = log.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('Agent/CI context, host state may be unavailable');
    expect(output).toContain('WorkOS home directory (/Users/test/.workos)');
    expect(output).not.toContain('EACCES: permission denied');

    log.mockRestore();
  });
});

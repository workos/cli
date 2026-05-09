import { describe, it, expect } from 'vitest';
import { detectIssues } from './issues.js';
import type { DoctorReport } from './types.js';

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
});

import { describe, it, expect } from 'vitest';
import { formatReportAsJson } from './json-output.js';
import type { DoctorReport } from './types.js';

function report(): DoctorReport {
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
  };
}

describe('formatReportAsJson', () => {
  it('includes top-level interaction mode', () => {
    const json = JSON.parse(formatReportAsJson(report()));

    expect(json.interactionMode).toEqual({ mode: 'agent', source: 'env' });
    expect(json.hostExecution).toMatchObject({ mode: 'non-interactive', ok: true });
  });
});

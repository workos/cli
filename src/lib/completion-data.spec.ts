import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCompletionData } from './completion-data.js';
import { resolveDevCommand } from './dev-command.js';
import { detectPort } from './port-detection.js';

describe('buildCompletionData', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), 'workos-completion-test-'));
  });

  afterEach(() => {
    rmSync(installDir, { recursive: true, force: true });
  });

  function writePackageJson(content: Record<string, unknown>): void {
    writeFileSync(join(installDir, 'package.json'), JSON.stringify(content));
  }

  function writeFile(name: string, content = ''): void {
    writeFileSync(join(installDir, name), content);
  }

  const baseDeps = {
    resolveDevCommand,
    detectPort,
    docsUrl: 'https://d',
    dashboardUrl: 'https://dash',
  };

  it('builds a lockfile-aware dev command, url, files, and next steps (happy path)', async () => {
    writePackageJson({ scripts: { dev: 'next dev' }, dependencies: { next: '15.0.0' } });
    writeFile('pnpm-lock.yaml', 'lockfileVersion: 9\n');

    const data = await buildCompletionData(
      { integration: 'nextjs', changedFiles: ['app/auth/route.ts', '.env.local'], installDir },
      baseDeps,
    );

    expect(data.devCommand).toBe('pnpm run dev');
    expect(data.url).toBe('http://localhost:3000');
    expect(data.files).toHaveLength(2);
    expect(data.nextSteps[0]).toContain('pnpm run dev');
    expect(data.nextSteps[1]).toContain('http://localhost:3000');
    expect(data.docsUrl).toBe('https://d');
    expect(data.dashboardUrl).toBe('https://dash');
    expect(data.integration).toBe('nextjs');
  });

  it('respects a Vite server.port override for react', async () => {
    writePackageJson({ scripts: { dev: 'vite' }, dependencies: { react: '18.0.0', vite: '5.0.0' } });
    writeFile('vite.config.ts', 'export default { server: { port: 8080 } };');

    const data = await buildCompletionData({ integration: 'react', changedFiles: [], installDir }, baseDeps);

    expect(data.url).toBe('http://localhost:8080');
  });

  it('handles empty changedFiles (--no-commit shape) without throwing', async () => {
    writePackageJson({ scripts: { dev: 'next dev' }, dependencies: { next: '15.0.0' } });

    const data = await buildCompletionData({ integration: 'nextjs', changedFiles: [], installDir }, baseDeps);

    expect(data.files).toEqual([]);
    expect(data.nextSteps[0]).toContain('start your dev server');
    expect(data.nextSteps[1]).toContain('test authentication');
  });

  it('drops the generic "start dev server" framework step but keeps others', async () => {
    writePackageJson({ scripts: { dev: 'next dev' }, dependencies: { next: '15.0.0' } });

    const data = await buildCompletionData(
      { integration: 'nextjs', changedFiles: [], installDir },
      {
        ...baseDeps,
        frameworkNextSteps: [
          'Start your development server to test authentication',
          'Visit the WorkOS Dashboard to manage users and settings',
        ],
      },
    );

    // The generic "start dev server" duplicate is filtered out...
    expect(data.nextSteps.filter((s) => /start your development server/i.test(s))).toHaveLength(0);
    // ...but the dashboard step is retained.
    expect(data.nextSteps.some((s) => /WorkOS Dashboard/.test(s))).toBe(true);
  });

  it('passes through a sign-in snippet into nextSteps and completion', async () => {
    writePackageJson({ scripts: { dev: 'next dev' }, dependencies: { next: '15.0.0' } });

    const snippet = 'Add a sign-in button using refreshAuth({ ensureSignedIn: true })';
    const data = await buildCompletionData(
      { integration: 'nextjs', changedFiles: [], installDir },
      { ...baseDeps, signInSnippet: snippet },
    );

    expect(data.signInSnippet).toBe(snippet);
    expect(data.nextSteps).toContain(snippet);
  });

  it('omits the sign-in snippet when not provided', async () => {
    writePackageJson({ scripts: { dev: 'next dev' }, dependencies: { next: '15.0.0' } });

    const data = await buildCompletionData({ integration: 'nextjs', changedFiles: [], installDir }, baseDeps);

    expect(data.signInSnippet).toBeUndefined();
    expect(data.nextSteps.some((s) => /refreshAuth/.test(s))).toBe(false);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveDevCommand, _detectPackageManager } from './dev-command.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('resolveDevCommand', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'workos-dev-test-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function writePackageJson(content: Record<string, any>): void {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify(content));
  }

  function writeFile(name: string, content = ''): void {
    writeFileSync(join(projectDir, name), content);
  }

  it('uses scripts.dev from package.json over framework defaults', async () => {
    writePackageJson({
      scripts: { dev: 'next dev --turbopack' },
      dependencies: { next: '15.0.0' },
    });

    const result = await resolveDevCommand(projectDir);
    expect(result.command).toBe('npm');
    expect(result.args).toEqual(['run', 'dev']);
    expect(result.framework).toBe('Next.js');
  });

  it('detects Next.js and falls back to next dev without scripts.dev', async () => {
    writePackageJson({
      dependencies: { next: '15.0.0' },
    });

    const result = await resolveDevCommand(projectDir);
    expect(result.command).toContain('next');
    expect(result.args).toEqual(['dev']);
    expect(result.framework).toBe('Next.js');
  });

  it('detects Vite project', async () => {
    writePackageJson({
      devDependencies: { vite: '^5.0.0' },
    });

    const result = await resolveDevCommand(projectDir);
    expect(result.command).toContain('vite');
    expect(result.args).toEqual(['dev']);
    expect(result.framework).toBe('Vite');
  });

  it('detects Remix project', async () => {
    writePackageJson({
      dependencies: { '@remix-run/dev': '^2.0.0' },
    });

    const result = await resolveDevCommand(projectDir);
    expect(result.command).toContain('remix');
    expect(result.args).toEqual(['dev']);
    expect(result.framework).toBe('Remix');
  });

  it('detects SvelteKit project', async () => {
    writePackageJson({
      devDependencies: { '@sveltejs/kit': '^2.0.0' },
    });

    const result = await resolveDevCommand(projectDir);
    expect(result.command).toContain('vite');
    expect(result.args).toEqual(['dev']);
    expect(result.framework).toBe('SvelteKit');
  });

  it('detects Django project via manage.py', async () => {
    writeFile('manage.py', '#!/usr/bin/env python');

    const result = await resolveDevCommand(projectDir);
    expect(result.command).toBe('python');
    expect(result.args).toEqual(['manage.py', 'runserver']);
    expect(result.framework).toBe('Django');
  });

  it('detects Rails project via Gemfile', async () => {
    writeFile('Gemfile', 'source "https://rubygems.org"');

    const result = await resolveDevCommand(projectDir);
    expect(result.command).toBe('rails');
    expect(result.args).toEqual(['server']);
    expect(result.framework).toBe('Rails');
  });

  it('detects Go project via go.mod', async () => {
    writeFile('go.mod', 'module example.com/app');

    const result = await resolveDevCommand(projectDir);
    expect(result.command).toBe('go');
    expect(result.args).toEqual(['run', '.']);
    expect(result.framework).toBe('Go');
  });

  it('falls back to npm run dev when nothing is detected', async () => {
    // Empty directory, no package.json, no framework files
    const result = await resolveDevCommand(projectDir);
    expect(result.command).toBe('npm');
    expect(result.args).toEqual(['run', 'dev']);
    expect(result.framework).toBeNull();
  });

  it('detects pnpm package manager from lockfile', async () => {
    writePackageJson({
      scripts: { dev: 'next dev' },
      dependencies: { next: '15.0.0' },
    });
    writeFile('pnpm-lock.yaml');

    const result = await resolveDevCommand(projectDir);
    expect(result.command).toBe('pnpm');
    expect(result.args).toEqual(['run', 'dev']);
  });

  it('detects yarn package manager from lockfile', async () => {
    writePackageJson({
      scripts: { dev: 'next dev' },
      dependencies: { next: '15.0.0' },
    });
    writeFile('yarn.lock');

    const result = await resolveDevCommand(projectDir);
    expect(result.command).toBe('yarn');
    expect(result.args).toEqual(['run', 'dev']);
  });

  it('detects bun package manager from lockfile', async () => {
    writePackageJson({
      scripts: { dev: 'next dev' },
      dependencies: { next: '15.0.0' },
    });
    writeFile('bun.lockb');

    const result = await resolveDevCommand(projectDir);
    expect(result.command).toBe('bun');
    expect(result.args).toEqual(['run', 'dev']);
  });

  it('prefers scripts.dev with detected framework for display', async () => {
    writePackageJson({
      scripts: { dev: 'remix dev' },
      dependencies: { '@remix-run/dev': '^2.0.0' },
    });

    const result = await resolveDevCommand(projectDir);
    // Uses package manager run (scripts.dev takes priority)
    expect(result.args).toEqual(['run', 'dev']);
    // But still reports the detected framework
    expect(result.framework).toBe('Remix');
  });

  it('uses node_modules/.bin path when binary exists', async () => {
    writePackageJson({
      dependencies: { next: '15.0.0' },
    });
    // Create a fake node_modules/.bin/next
    mkdirSync(join(projectDir, 'node_modules', '.bin'), { recursive: true });
    writeFile('node_modules/.bin/next', '#!/usr/bin/env node');

    const result = await resolveDevCommand(projectDir);
    expect(result.command).toBe(join(projectDir, 'node_modules', '.bin', 'next'));
    expect(result.args).toEqual(['dev']);
  });
});

describe('_detectPackageManager', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'workos-pm-test-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('defaults to npm when no lockfile found', () => {
    expect(_detectPackageManager(projectDir)).toBe('npm');
  });

  it('detects pnpm', () => {
    writeFileSync(join(projectDir, 'pnpm-lock.yaml'), '');
    expect(_detectPackageManager(projectDir)).toBe('pnpm');
  });

  it('detects yarn', () => {
    writeFileSync(join(projectDir, 'yarn.lock'), '');
    expect(_detectPackageManager(projectDir)).toBe('yarn');
  });

  it('detects bun', () => {
    writeFileSync(join(projectDir, 'bun.lockb'), '');
    expect(_detectPackageManager(projectDir)).toBe('bun');
  });
});

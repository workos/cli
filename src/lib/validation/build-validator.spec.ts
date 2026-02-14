import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectBuildCommand } from './build-validator.js';

describe('detectBuildCommand', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'build-detect-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('detects package.json with build script (pnpm)', async () => {
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({ scripts: { build: 'next build' } }));
    writeFileSync(join(testDir, 'pnpm-lock.yaml'), '');

    const cmd = await detectBuildCommand(testDir);

    expect(cmd).toEqual({ command: 'pnpm', args: ['build'] });
  });

  it('detects package.json with build script (npm)', async () => {
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({ scripts: { build: 'react-scripts build' } }));

    const cmd = await detectBuildCommand(testDir);

    expect(cmd).toEqual({ command: 'npm', args: ['run', 'build'] });
  });

  it('skips package.json without build script', async () => {
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({ scripts: { start: 'node index.js' } }));

    const cmd = await detectBuildCommand(testDir);

    expect(cmd).toBeNull();
  });

  it('detects go.mod → go build', async () => {
    writeFileSync(join(testDir, 'go.mod'), 'module example.com/app\n\ngo 1.21\n');

    const cmd = await detectBuildCommand(testDir);

    expect(cmd).toEqual({ command: 'go', args: ['build', './...'] });
  });

  it('detects mix.exs → mix compile', async () => {
    writeFileSync(join(testDir, 'mix.exs'), 'defmodule MyApp.MixProject do\nend\n');

    const cmd = await detectBuildCommand(testDir);

    expect(cmd).toEqual({ command: 'mix', args: ['compile'] });
  });

  it('detects *.csproj → dotnet build', async () => {
    writeFileSync(join(testDir, 'MyApp.csproj'), '<Project Sdk="Microsoft.NET.Sdk">\n</Project>\n');

    const cmd = await detectBuildCommand(testDir);

    expect(cmd).toEqual({ command: 'dotnet', args: ['build'] });
  });

  it('detects build.gradle.kts with gradlew → ./gradlew build', async () => {
    writeFileSync(join(testDir, 'build.gradle.kts'), 'plugins { kotlin("jvm") }\n');
    writeFileSync(join(testDir, 'gradlew'), '#!/bin/sh\nexec gradle "$@"\n');

    const cmd = await detectBuildCommand(testDir);

    expect(cmd).toEqual({ command: './gradlew', args: ['build'] });
  });

  it('detects build.gradle without gradlew → gradle build', async () => {
    writeFileSync(join(testDir, 'build.gradle'), 'apply plugin: "java"\n');

    const cmd = await detectBuildCommand(testDir);

    expect(cmd).toEqual({ command: 'gradle', args: ['build'] });
  });

  it('returns null for empty directory', async () => {
    const cmd = await detectBuildCommand(testDir);

    expect(cmd).toBeNull();
  });

  it('returns null for Python project (no universal build)', async () => {
    writeFileSync(join(testDir, 'pyproject.toml'), '[project]\nname = "myapp"\n');
    writeFileSync(join(testDir, 'app.py'), 'print("hello")\n');

    const cmd = await detectBuildCommand(testDir);

    expect(cmd).toBeNull();
  });

  it('returns null for Ruby project (no universal build)', async () => {
    writeFileSync(join(testDir, 'Gemfile'), 'source "https://rubygems.org"\ngem "rails"\n');

    const cmd = await detectBuildCommand(testDir);

    expect(cmd).toBeNull();
  });

  it('package.json build script takes priority over go.mod', async () => {
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({ scripts: { build: 'tsc' } }));
    writeFileSync(join(testDir, 'go.mod'), 'module example.com/app\n');
    writeFileSync(join(testDir, 'pnpm-lock.yaml'), '');

    const cmd = await detectBuildCommand(testDir);

    expect(cmd).toEqual({ command: 'pnpm', args: ['build'] });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkLanguage } from './language.js';

describe('checkLanguage', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'doctor-lang-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('detects JavaScript/TypeScript from package.json', async () => {
    await writeFile(join(dir, 'package.json'), '{}');
    const result = await checkLanguage(dir);
    expect(result.name).toBe('JavaScript/TypeScript');
    expect(result.manifestFile).toBe('package.json');
  });

  it('detects Python from requirements.txt', async () => {
    await writeFile(join(dir, 'requirements.txt'), 'workos==4.0.0\n');
    const result = await checkLanguage(dir);
    expect(result.name).toBe('Python');
    expect(result.manifestFile).toBe('requirements.txt');
    expect(result.packageManager).toBe('pip');
  });

  it('detects Python from pyproject.toml with poetry package manager', async () => {
    await writeFile(join(dir, 'pyproject.toml'), '[tool.poetry]\nname = "myapp"\n');
    const result = await checkLanguage(dir);
    expect(result.name).toBe('Python');
    expect(result.manifestFile).toBe('pyproject.toml');
    expect(result.packageManager).toBe('poetry');
  });

  it('detects Python from Pipfile with pipenv package manager', async () => {
    await writeFile(join(dir, 'Pipfile'), '[packages]\nworkos = "*"\n');
    const result = await checkLanguage(dir);
    expect(result.name).toBe('Python');
    expect(result.packageManager).toBe('pipenv');
  });

  it('detects Ruby from Gemfile', async () => {
    await writeFile(join(dir, 'Gemfile'), "gem 'workos'\n");
    const result = await checkLanguage(dir);
    expect(result.name).toBe('Ruby');
    expect(result.manifestFile).toBe('Gemfile');
    expect(result.packageManager).toBe('bundler');
  });

  it('detects Go from go.mod', async () => {
    await writeFile(join(dir, 'go.mod'), 'module myapp\ngo 1.21\n');
    const result = await checkLanguage(dir);
    expect(result.name).toBe('Go');
    expect(result.manifestFile).toBe('go.mod');
    expect(result.packageManager).toBe('go modules');
  });

  it('detects Java from pom.xml', async () => {
    await writeFile(join(dir, 'pom.xml'), '<project></project>');
    const result = await checkLanguage(dir);
    expect(result.name).toBe('Java');
    expect(result.manifestFile).toBe('pom.xml');
  });

  it('detects Java from build.gradle', async () => {
    await writeFile(join(dir, 'build.gradle'), 'plugins {}');
    const result = await checkLanguage(dir);
    expect(result.name).toBe('Java');
    expect(result.manifestFile).toBe('build.gradle');
  });

  it('detects PHP from composer.json', async () => {
    await writeFile(join(dir, 'composer.json'), '{}');
    const result = await checkLanguage(dir);
    expect(result.name).toBe('PHP');
    expect(result.manifestFile).toBe('composer.json');
  });

  it('detects C#/.NET from *.csproj', async () => {
    await writeFile(join(dir, 'MyApp.csproj'), '<Project></Project>');
    const result = await checkLanguage(dir);
    expect(result.name).toBe('C#/.NET');
    expect(result.manifestFile).toBe('MyApp.csproj');
  });

  it('returns Unknown for empty directory', async () => {
    const result = await checkLanguage(dir);
    expect(result.name).toBe('Unknown');
    expect(result.manifestFile).toBeUndefined();
  });

  it('prioritizes Go over JS in polyglot project', async () => {
    await writeFile(join(dir, 'go.mod'), 'module myapp\n');
    await writeFile(join(dir, 'package.json'), '{}');
    const result = await checkLanguage(dir);
    expect(result.name).toBe('Go');
  });

  it('prioritizes Ruby over JS in polyglot project', async () => {
    await writeFile(join(dir, 'Gemfile'), "gem 'rails'\n");
    await writeFile(join(dir, 'package.json'), '{}');
    const result = await checkLanguage(dir);
    expect(result.name).toBe('Ruby');
  });

  it('prioritizes Python over JS in polyglot project', async () => {
    await writeFile(join(dir, 'requirements.txt'), 'django\n');
    await writeFile(join(dir, 'package.json'), '{}');
    const result = await checkLanguage(dir);
    expect(result.name).toBe('Python');
  });
});

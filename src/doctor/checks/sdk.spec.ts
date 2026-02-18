import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkSdk } from './sdk.js';

describe('checkSdk - non-JS languages', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'doctor-sdk-'));
    // Create a package.json with no WorkOS SDK so JS check falls through
    await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: {} }));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('detects workos-python from requirements.txt', async () => {
    await writeFile(join(dir, 'requirements.txt'), 'flask\nworkos==4.1.0\nrequests\n');
    const result = await checkSdk({ installDir: dir });
    expect(result.name).toBe('workos-python');
    expect(result.version).toBe('4.1.0');
    expect(result.language).toBe('python');
  });

  it('detects workos-python from requirements.txt without version', async () => {
    await writeFile(join(dir, 'requirements.txt'), 'workos\n');
    const result = await checkSdk({ installDir: dir });
    expect(result.name).toBe('workos-python');
    expect(result.language).toBe('python');
  });

  it('detects workos-python from pyproject.toml', async () => {
    await writeFile(
      join(dir, 'pyproject.toml'),
      '[project]\ndependencies = ["workos>=4.0"]\n',
    );
    const result = await checkSdk({ installDir: dir });
    expect(result.name).toBe('workos-python');
    expect(result.language).toBe('python');
  });

  it('detects workos-ruby from Gemfile', async () => {
    await writeFile(join(dir, 'Gemfile'), "source 'https://rubygems.org'\ngem 'workos'\n");
    const result = await checkSdk({ installDir: dir });
    expect(result.name).toBe('workos-ruby');
    expect(result.language).toBe('ruby');
  });

  it('detects workos-go from go.mod', async () => {
    await writeFile(
      join(dir, 'go.mod'),
      'module myapp\n\ngo 1.21\n\nrequire github.com/workos/workos-go/v4 v4.1.0\n',
    );
    const result = await checkSdk({ installDir: dir });
    expect(result.name).toBe('workos-go');
    expect(result.version).toBe('v4.1.0');
    expect(result.language).toBe('go');
  });

  it('detects workos-java from pom.xml', async () => {
    await writeFile(
      join(dir, 'pom.xml'),
      '<project><dependencies><dependency><groupId>com.workos</groupId></dependency></dependencies></project>',
    );
    const result = await checkSdk({ installDir: dir });
    expect(result.name).toBe('workos-java');
    expect(result.language).toBe('java');
  });

  it('detects workos-java from build.gradle', async () => {
    await writeFile(
      join(dir, 'build.gradle'),
      "dependencies {\n  implementation 'com.workos:workos-java:1.0.0'\n}\n",
    );
    const result = await checkSdk({ installDir: dir });
    expect(result.name).toBe('workos-java');
    expect(result.language).toBe('java');
  });

  it('detects workos-php from composer.json', async () => {
    await writeFile(
      join(dir, 'composer.json'),
      JSON.stringify({ require: { 'workos/workos-php': '^2.0' } }),
    );
    const result = await checkSdk({ installDir: dir });
    expect(result.name).toBe('workos-php');
    expect(result.language).toBe('php');
  });

  it('detects WorkOS.net from .csproj', async () => {
    await writeFile(
      join(dir, 'MyApp.csproj'),
      '<Project><ItemGroup><PackageReference Include="WorkOS.net" Version="1.5.0" /></ItemGroup></Project>',
    );
    const result = await checkSdk({ installDir: dir });
    expect(result.name).toBe('WorkOS.net');
    expect(result.version).toBe('1.5.0');
    expect(result.language).toBe('dotnet');
  });

  it('returns null SDK when no WorkOS package in any manifest', async () => {
    await writeFile(join(dir, 'requirements.txt'), 'flask\nrequests\n');
    const result = await checkSdk({ installDir: dir });
    expect(result.name).toBeNull();
  });

  it('sets outdated to false for non-JS SDKs', async () => {
    await writeFile(join(dir, 'requirements.txt'), 'workos==4.1.0\n');
    const result = await checkSdk({ installDir: dir });
    expect(result.outdated).toBe(false);
  });

  it('sets latest to null for non-JS SDKs', async () => {
    await writeFile(join(dir, 'requirements.txt'), 'workos==4.1.0\n');
    const result = await checkSdk({ installDir: dir });
    expect(result.latest).toBeNull();
  });
});

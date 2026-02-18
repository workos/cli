import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkFramework } from './framework.js';

function makePackageJson(deps: Record<string, string> = {}): string {
  return JSON.stringify({ dependencies: deps });
}

describe('checkFramework - new frameworks', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'doctor-fw-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('detects Expo (managed)', async () => {
    await writeFile(join(dir, 'package.json'), makePackageJson({ expo: '~50.0.0' }));
    const result = await checkFramework({ installDir: dir });
    expect(result.name).toBe('Expo');
    expect(result.variant).toBe('managed');
  });

  it('detects Expo (bare) when ios/ or android/ exists', async () => {
    await writeFile(join(dir, 'package.json'), makePackageJson({ expo: '~50.0.0' }));
    await mkdir(join(dir, 'ios'));
    const result = await checkFramework({ installDir: dir });
    expect(result.name).toBe('Expo');
    expect(result.variant).toBe('bare');
  });

  it('detects React Native without Expo', async () => {
    await writeFile(join(dir, 'package.json'), makePackageJson({ 'react-native': '0.73.0' }));
    const result = await checkFramework({ installDir: dir });
    expect(result.name).toBe('React Native');
  });

  it('prefers Expo over React Native', async () => {
    await writeFile(join(dir, 'package.json'), makePackageJson({ expo: '~50.0.0', 'react-native': '0.73.0' }));
    const result = await checkFramework({ installDir: dir });
    expect(result.name).toBe('Expo');
  });

  it('detects SvelteKit', async () => {
    await writeFile(join(dir, 'package.json'), makePackageJson({ '@sveltejs/kit': '2.0.0' }));
    const result = await checkFramework({ installDir: dir });
    expect(result.name).toBe('SvelteKit');
  });

  it('detects Nuxt 3', async () => {
    await writeFile(join(dir, 'package.json'), makePackageJson({ nuxt: '3.8.0' }));
    const result = await checkFramework({ installDir: dir });
    expect(result.name).toBe('Nuxt');
    expect(result.variant).toBe('Nuxt 3');
  });

  it('detects Vue.js standalone', async () => {
    await writeFile(join(dir, 'package.json'), makePackageJson({ vue: '3.4.0' }));
    const result = await checkFramework({ installDir: dir });
    expect(result.name).toBe('Vue.js');
  });

  it('prefers Nuxt over Vue', async () => {
    await writeFile(join(dir, 'package.json'), makePackageJson({ nuxt: '3.8.0', vue: '3.4.0' }));
    const result = await checkFramework({ installDir: dir });
    expect(result.name).toBe('Nuxt');
  });

  it('detects Astro', async () => {
    await writeFile(join(dir, 'package.json'), makePackageJson({ astro: '4.0.0' }));
    const result = await checkFramework({ installDir: dir });
    expect(result.name).toBe('Astro');
  });

  it('detects Svelte (without Kit)', async () => {
    await writeFile(join(dir, 'package.json'), makePackageJson({ svelte: '4.0.0' }));
    const result = await checkFramework({ installDir: dir });
    expect(result.name).toBe('Svelte');
  });

  it('prefers SvelteKit over Svelte', async () => {
    await writeFile(join(dir, 'package.json'), makePackageJson({ '@sveltejs/kit': '2.0.0', svelte: '4.0.0' }));
    const result = await checkFramework({ installDir: dir });
    expect(result.name).toBe('SvelteKit');
  });

  it('returns null for no frameworks', async () => {
    await writeFile(join(dir, 'package.json'), makePackageJson({}));
    const result = await checkFramework({ installDir: dir });
    expect(result.name).toBeNull();
  });

  it('returns null for no package.json', async () => {
    const result = await checkFramework({ installDir: dir });
    expect(result.name).toBeNull();
  });
});

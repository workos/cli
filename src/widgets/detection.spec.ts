import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { detectWidgetsProject } from './detection.js';

const tempDirs: string[] = [];

async function createTempProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'workos-widgets-'));
  tempDirs.push(dir);
  return dir;
}

async function writePackageJson(dir: string, pkg: Record<string, unknown>): Promise<void> {
  await writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe('detectWidgetsProject', () => {
  it('detects framework, component system, and package manager', async () => {
    const dir = await createTempProject();
    await writePackageJson(dir, {
      dependencies: {
        next: '14.0.0',
        react: '18.0.0',
      },
    });
    await writeFile(path.join(dir, 'components.json'), '{}');
    await writeFile(path.join(dir, 'pnpm-lock.yaml'), '');

    const result = await detectWidgetsProject({ installDir: dir });
    expect(result.framework).toBe('nextjs');
    expect(result.componentSystem).toBe('shadcn');
    expect(result.packageManager).toBe('pnpm');
  });

  it('detects data fetching and styling', async () => {
    const dir = await createTempProject();
    await writePackageJson(dir, {
      dependencies: {
        react: '18.0.0',
        '@tanstack/react-query': '5.0.0',
        tailwindcss: '3.4.0',
      },
    });
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, 'tailwind.config.ts'), 'export default {};');

    const result = await detectWidgetsProject({ installDir: dir });
    expect(result.dataFetching).toBe('react-query');
    expect(result.styling).toBe('tailwind');
  });
});

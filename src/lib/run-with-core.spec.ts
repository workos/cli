import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectSingleIntegration } from './run-with-core.js';

describe('detectSingleIntegration', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'detect-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Regression guard: getPackageDotJson() calls process.exit(1) when package.json
  // is missing, which previously aborted the whole installer in Django projects
  // before Python detection ran.
  it('returns false for JS integrations when no package.json exists', async () => {
    await writeFile(join(dir, 'manage.py'), '# django');
    await writeFile(join(dir, 'requirements.txt'), 'django>=5.0\n');

    const result = await detectSingleIntegration('nextjs', { installDir: dir });
    expect(result).toBe(false);
  });

  it('detects python integration via pyproject.toml', async () => {
    await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\ndependencies = ["django>=5.0"]\n');

    const result = await detectSingleIntegration('python', { installDir: dir });
    expect(result).toBe(true);
  });

  it('detects python integration via manage.py alone', async () => {
    await writeFile(join(dir, 'manage.py'), '# django entrypoint');

    const result = await detectSingleIntegration('python', { installDir: dir });
    expect(result).toBe(true);
  });

  it('detects python integration via requirements.txt with django', async () => {
    await writeFile(join(dir, 'requirements.txt'), 'django>=5.0\n');

    const result = await detectSingleIntegration('python', { installDir: dir });
    expect(result).toBe(true);
  });

  it('does not detect python for a non-django python project', async () => {
    await writeFile(join(dir, 'requirements.txt'), 'flask>=3.0\n');

    const result = await detectSingleIntegration('python', { installDir: dir });
    expect(result).toBe(false);
  });
});

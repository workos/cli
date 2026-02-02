import { cp, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileNoThrow } from '../../src/utils/exec-file.js';

export interface FixtureOptions {
  keepOnFail?: boolean;
}

export class FixtureManager {
  private tempDir: string | null = null;
  private options: FixtureOptions;

  constructor(
    private framework: string,
    private state: string,
    options: FixtureOptions = {},
  ) {
    this.options = options;
  }

  async setup(): Promise<string> {
    // Create temp directory with random suffix for parallel safety
    const suffix = Math.random().toString(36).substring(2, 8);
    this.tempDir = await mkdtemp(join(tmpdir(), `eval-${this.framework}-${this.state}-${suffix}-`));

    // Copy fixture files
    const fixtureSource = join(process.cwd(), 'tests/fixtures', this.framework, this.state);

    await cp(fixtureSource, this.tempDir, { recursive: true });

    // Install dependencies using safe exec
    console.log('  Installing dependencies...');
    const result = await execFileNoThrow('pnpm', ['install'], {
      cwd: this.tempDir,
    });

    if (result.status !== 0) {
      throw new Error(`pnpm install failed: ${result.stderr}`);
    }

    // Initialize git repo for diff capture (quality grading)
    await execFileNoThrow('git', ['init'], { cwd: this.tempDir });
    await execFileNoThrow('git', ['add', '-A'], { cwd: this.tempDir });
    await execFileNoThrow('git', ['commit', '-m', 'initial', '--no-gpg-sign'], { cwd: this.tempDir });

    return this.tempDir;
  }

  async cleanup(): Promise<void> {
    if (this.tempDir) {
      await rm(this.tempDir, { recursive: true, force: true });
      this.tempDir = null;
    }
  }

  getTempDir(): string | null {
    return this.tempDir;
  }
}

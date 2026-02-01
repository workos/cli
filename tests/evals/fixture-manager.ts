import { cp, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileNoThrow } from '../../src/utils/exec-file.js';

export class FixtureManager {
  private tempDir: string | null = null;

  constructor(
    private framework: string,
    private state: string
  ) {}

  async setup(): Promise<string> {
    // Create temp directory
    this.tempDir = await mkdtemp(join(tmpdir(), `eval-${this.framework}-`));

    // Copy fixture files
    const fixtureSource = join(
      process.cwd(),
      'tests/fixtures',
      this.framework,
      this.state
    );

    await cp(fixtureSource, this.tempDir, { recursive: true });

    // Install dependencies using safe exec
    console.log('  Installing dependencies...');
    const result = await execFileNoThrow('pnpm', ['install'], {
      cwd: this.tempDir,
    });

    if (result.status !== 0) {
      throw new Error(`pnpm install failed: ${result.stderr}`);
    }

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

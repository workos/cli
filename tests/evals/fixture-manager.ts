import { cp, rm, mkdtemp } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
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

    // Install dependencies — detect language and use appropriate package manager
    console.log('  Installing dependencies...');
    await this.installDependencies(this.tempDir);

    // Initialize git repo for diff capture (quality grading)
    await execFileNoThrow('git', ['init'], { cwd: this.tempDir });
    await execFileNoThrow('git', ['add', '-A'], { cwd: this.tempDir });
    await execFileNoThrow('git', ['commit', '-m', 'initial', '--no-gpg-sign'], { cwd: this.tempDir });

    return this.tempDir;
  }

  async cleanup(): Promise<void> {
    if (this.tempDir) {
      try {
        await rm(this.tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
      } catch {
        // Best-effort cleanup — don't let temp dir issues fail scenarios
      }
      this.tempDir = null;
    }
  }

  getTempDir(): string | null {
    return this.tempDir;
  }

  /**
   * Detect project language and install dependencies using the appropriate package manager.
   */
  private async installDependencies(workDir: string): Promise<void> {
    // JS projects
    if (existsSync(join(workDir, 'package.json'))) {
      const result = await execFileNoThrow('pnpm', ['install'], { cwd: workDir });
      if (result.status !== 0) throw new Error(`pnpm install failed: ${result.stderr}`);
      return;
    }

    // Python
    if (existsSync(join(workDir, 'requirements.txt'))) {
      const result = await execFileNoThrow('pip', ['install', '-r', 'requirements.txt'], { cwd: workDir });
      if (result.status !== 0) throw new Error(`pip install failed: ${result.stderr}`);
      return;
    }
    if (existsSync(join(workDir, 'pyproject.toml'))) {
      const result = await execFileNoThrow('pip', ['install', '-e', '.'], { cwd: workDir });
      if (result.status !== 0) throw new Error(`pip install failed: ${result.stderr}`);
      return;
    }

    // Ruby
    if (existsSync(join(workDir, 'Gemfile'))) {
      const result = await execFileNoThrow('bundle', ['install'], { cwd: workDir });
      if (result.status !== 0) throw new Error(`bundle install failed: ${result.stderr}`);
      return;
    }

    // Go
    if (existsSync(join(workDir, 'go.mod'))) {
      const result = await execFileNoThrow('go', ['mod', 'download'], { cwd: workDir });
      if (result.status !== 0) throw new Error(`go mod download failed: ${result.stderr}`);
      return;
    }

    // PHP
    if (existsSync(join(workDir, 'composer.json'))) {
      const result = await execFileNoThrow('composer', ['install', '--no-interaction'], { cwd: workDir });
      if (result.status !== 0) throw new Error(`composer install failed: ${result.stderr}`);
      return;
    }

    // Elixir
    if (existsSync(join(workDir, 'mix.exs'))) {
      const result = await execFileNoThrow('mix', ['deps.get'], { cwd: workDir });
      if (result.status !== 0) throw new Error(`mix deps.get failed: ${result.stderr}`);
      return;
    }

    // .NET
    const csprojFiles = readdirSync(workDir).filter((f) => f.endsWith('.csproj'));
    if (csprojFiles.length > 0) {
      const result = await execFileNoThrow('dotnet', ['restore'], { cwd: workDir });
      if (result.status !== 0) throw new Error(`dotnet restore failed: ${result.stderr}`);
      return;
    }

    // Kotlin/Gradle — deps resolved at build time, skip
    if (existsSync(join(workDir, 'build.gradle.kts')) || existsSync(join(workDir, 'build.gradle'))) {
      return;
    }

    console.warn('  No recognized dependency manifest found, skipping install');
  }
}

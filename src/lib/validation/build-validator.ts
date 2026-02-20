import { spawn } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { ValidationIssue } from './types.js';

export interface BuildResult {
  success: boolean;
  issues: ValidationIssue[];
  durationMs: number;
  stdout: string;
  stderr: string;
}

export async function runBuildValidation(projectDir: string, timeoutMs: number = 60000): Promise<BuildResult> {
  const startTime = Date.now();
  const pm = detectPackageManager(projectDir);
  const hasBuildScript = await hasBuildScriptInPackageJson(projectDir);

  if (!hasBuildScript) {
    return {
      success: true,
      issues: [],
      durationMs: Date.now() - startTime,
      stdout: '',
      stderr: '',
    };
  }

  return new Promise((resolve) => {
    const args = pm === 'npm' ? ['run', 'build'] : ['build'];
    const proc = spawn(pm, args, {
      cwd: projectDir,
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      const issues: ValidationIssue[] = [];

      if (code !== 0) {
        // Parse errors from output
        const errors = parseBuildErrors(stdout + stderr);
        for (const error of errors) {
          issues.push({
            type: 'file',
            severity: 'error',
            message: `Build error: ${error}`,
            hint: 'Fix the error and run build again',
          });
        }

        // Fallback if no specific errors parsed
        if (issues.length === 0) {
          issues.push({
            type: 'file',
            severity: 'error',
            message: 'Build failed',
            hint: `Run \`${pm} ${args.join(' ')}\` to see full output`,
          });
        }
      }

      resolve({
        success: code === 0,
        issues,
        durationMs: Date.now() - startTime,
        stdout,
        stderr,
      });
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        issues: [
          {
            type: 'file',
            severity: 'warning',
            message: `Could not run build: ${err.message}`,
            hint: 'Build validation skipped',
          },
        ],
        durationMs: Date.now() - startTime,
        stdout: '',
        stderr: '',
      });
    });
  });
}

export function detectPackageManager(projectDir: string): 'pnpm' | 'yarn' | 'npm' {
  if (existsSync(join(projectDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(projectDir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

export async function hasBuildScriptInPackageJson(projectDir: string): Promise<boolean> {
  try {
    const content = await readFile(join(projectDir, 'package.json'), 'utf-8');
    const pkg = JSON.parse(content) as { scripts?: { build?: string } };
    return !!pkg.scripts?.build;
  } catch {
    return false;
  }
}

export interface BuildCommand {
  command: string;
  args: string[];
}

/**
 * Detect the build command for a project by checking ecosystem markers.
 * Returns null if no build system detected — caller should skip build validation.
 */
export async function detectBuildCommand(projectDir: string): Promise<BuildCommand | null> {
  const pm = detectPackageManager(projectDir);
  if (await hasBuildScriptInPackageJson(projectDir)) {
    const args = pm === 'npm' ? ['run', 'build'] : ['build'];
    return { command: pm, args };
  }

  if (existsSync(join(projectDir, 'go.mod'))) {
    return { command: 'go', args: ['build', './...'] };
  }

  if (existsSync(join(projectDir, 'mix.exs'))) {
    return { command: 'mix', args: ['compile'] };
  }

  try {
    const files = readdirSync(projectDir);
    if (files.some((f) => f.endsWith('.csproj'))) {
      return { command: 'dotnet', args: ['build'] };
    }
  } catch {
    // Can't read directory
  }

  if (existsSync(join(projectDir, 'build.gradle.kts')) || existsSync(join(projectDir, 'build.gradle'))) {
    const gradlew = existsSync(join(projectDir, 'gradlew')) ? './gradlew' : 'gradle';
    return { command: gradlew, args: ['build'] };
  }

  return null;
}

export function parseBuildErrors(output: string): string[] {
  const errors: string[] = [];

  // TypeScript errors: "file.ts(line,col): error TS..."
  const tsErrors = output.match(/[\w./]+\.\w+\(\d+,\d+\):\s*error\s+TS\d+:.+/g);
  if (tsErrors) {
    errors.push(...tsErrors.slice(0, 5)); // Limit to first 5
  }

  // Next.js errors: "Error: ..."
  const nextErrors = output.match(/Error:\s+.+/g);
  if (nextErrors) {
    errors.push(...nextErrors.slice(0, 5));
  }

  // ESLint errors: "file.ts line:col error ..."
  const eslintErrors = output.match(/[\w./]+:\d+:\d+\s+error\s+.+/g);
  if (eslintErrors) {
    errors.push(...eslintErrors.slice(0, 5));
  }

  return errors;
}

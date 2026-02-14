import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { QuickCheckResult, QuickChecksOutput, ValidationIssue } from './types.js';
import { detectBuildCommand, detectPackageManager, parseBuildErrors } from './build-validator.js';

const DEFAULT_TYPECHECK_TIMEOUT_MS = 30_000;
const DEFAULT_BUILD_TIMEOUT_MS = 60_000;

/**
 * Run fast deterministic checks: typecheck first, then build.
 * Short-circuits: if typecheck fails, skip build (build will fail too).
 */
export async function runQuickChecks(
  projectDir: string,
  options?: { skipBuild?: boolean; timeoutMs?: number },
): Promise<QuickChecksOutput> {
  const startTime = Date.now();
  const results: QuickCheckResult[] = [];

  const typecheckResult = await runTypecheckValidation(projectDir, options?.timeoutMs ?? DEFAULT_TYPECHECK_TIMEOUT_MS);
  results.push(typecheckResult);

  if (typecheckResult.passed && !options?.skipBuild) {
    results.push(await runBuildQuickCheck(projectDir, options?.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS));
  }

  const passed = results.every((r) => r.passed);

  return {
    passed,
    results,
    agentRetryPrompt: passed ? null : formatForAgent(results),
    totalDurationMs: Date.now() - startTime,
  };
}

function passResult(phase: QuickCheckResult['phase'], startTime: number): QuickCheckResult {
  return { passed: true, phase, issues: [], agentPrompt: null, durationMs: Date.now() - startTime };
}

/**
 * Run typecheck only (tsc --noEmit or framework equivalent).
 * Faster than full build — catches type errors in ~5s.
 */
export async function runTypecheckValidation(
  projectDir: string,
  timeoutMs: number = DEFAULT_TYPECHECK_TIMEOUT_MS,
): Promise<QuickCheckResult> {
  const startTime = Date.now();
  const typecheckCmd = await detectTypecheckCommand(projectDir);

  if (!typecheckCmd) {
    return passResult('typecheck', startTime);
  }

  const { exitCode, stdout, stderr } = await spawnCommand(
    typecheckCmd.command,
    typecheckCmd.args,
    projectDir,
    timeoutMs,
  );

  if (exitCode === 0) {
    return passResult('typecheck', startTime);
  }

  const output = stdout + stderr;
  const errors = parseTypecheckErrors(output);
  const issues: ValidationIssue[] = errors.map((error) => ({
    type: 'file',
    severity: 'error',
    message: `Type error: ${error}`,
    hint: 'Fix the type error and run typecheck again',
  }));

  if (issues.length === 0) {
    issues.push({
      type: 'file',
      severity: 'error',
      message: 'Typecheck failed',
      hint: `Run \`${typecheckCmd.command} ${typecheckCmd.args.join(' ')}\` to see full output`,
    });
  }

  return {
    passed: false,
    phase: 'typecheck',
    issues,
    agentPrompt: formatTypecheckErrors(errors, output),
    durationMs: Date.now() - startTime,
  };
}

async function runBuildQuickCheck(projectDir: string, timeoutMs: number): Promise<QuickCheckResult> {
  const startTime = Date.now();
  const buildCmd = await detectBuildCommand(projectDir);

  if (!buildCmd) {
    return passResult('build', startTime);
  }

  const { exitCode, stdout, stderr } = await spawnCommand(buildCmd.command, buildCmd.args, projectDir, timeoutMs);

  if (exitCode === 0) {
    return passResult('build', startTime);
  }

  const output = stdout + stderr;
  const errors = parseBuildErrors(output);
  const issues: ValidationIssue[] =
    errors.length > 0
      ? errors.map((e) => ({
          type: 'file',
          severity: 'error',
          message: `Build error: ${e}`,
          hint: 'Fix the error and run build again',
        }))
      : [
          {
            type: 'file',
            severity: 'error',
            message: 'Build failed',
            hint: `Run \`${buildCmd.command} ${buildCmd.args.join(' ')}\` to see full output`,
          },
        ];

  return {
    passed: false,
    phase: 'build',
    issues,
    agentPrompt: formatBuildErrors(issues),
    durationMs: Date.now() - startTime,
  };
}

interface TypecheckCommand {
  command: string;
  args: string[];
}

async function detectTypecheckCommand(projectDir: string): Promise<TypecheckCommand | null> {
  const pm = detectPackageManager(projectDir);

  try {
    const content = await readFile(join(projectDir, 'package.json'), 'utf-8');
    const pkg = JSON.parse(content) as { scripts?: Record<string, string> };

    const scriptName = pkg.scripts?.typecheck ? 'typecheck' : pkg.scripts?.['type-check'] ? 'type-check' : null;
    if (scriptName) {
      const args = pm === 'npm' ? ['run', scriptName] : [scriptName];
      return { command: pm, args };
    }
  } catch {
    // No package.json or malformed
  }

  try {
    await readFile(join(projectDir, 'tsconfig.json'), 'utf-8');
    return { command: 'npx', args: ['tsc', '--noEmit'] };
  } catch {
    return null;
  }
}

function parseTypecheckErrors(output: string): string[] {
  // Match both TS error formats:
  //   src/file.ts(line,col): error TS2345: ...
  //   src/file.ts:line:col - error TS2345: ...  (tsc --pretty)
  const pattern = /[\w./]+\.\w+(?:\(\d+,\d+\):\s*|:\d+:\d+\s*-\s*)error\s+TS\d+:.+/g;
  const matches = output.match(pattern);
  return matches ? [...new Set(matches)].slice(0, 10) : [];
}

function formatTypecheckErrors(errors: string[], rawOutput: string): string {
  if (errors.length === 0) {
    // Couldn't parse specific errors — give raw output
    const truncated = rawOutput.slice(0, 2000);
    return `The typecheck failed. Here is the output:\n\n${truncated}\n\nFix the type errors shown above.`;
  }

  const lines = errors.map((error) => {
    // Extract file:line info and error description
    const fileMatch = error.match(/([\w./]+\.\w+)[:(]\d+/);
    const tsMatch = error.match(/error\s+(TS\d+):\s*(.+)/);

    if (fileMatch && tsMatch) {
      return `- ${fileMatch[1]}: ${tsMatch[2]} (${tsMatch[1]})`;
    }
    return `- ${error}`;
  });

  return `The typecheck failed with ${errors.length} error${errors.length === 1 ? '' : 's'}:\n\n${lines.join('\n')}\n\nFix these type errors in the indicated files.`;
}

function formatBuildErrors(issues: ValidationIssue[]): string {
  const errorMessages = issues.map((i) => `- ${i.message}`);
  return `The build failed:\n\n${errorMessages.join('\n')}\n\nFix these build errors.`;
}

function formatForAgent(results: QuickCheckResult[]): string {
  return results
    .filter((r) => !r.passed && r.agentPrompt)
    .map((r) => r.agentPrompt!)
    .join('\n\n');
}

/**
 * Validation callback suitable for RetryConfig.validateAndFormat.
 * Returns null if checks pass, or an agent-ready error prompt if they fail.
 */
export async function quickCheckValidateAndFormat(workingDirectory: string): Promise<string | null> {
  const result = await runQuickChecks(workingDirectory);
  return result.passed ? null : result.agentRetryPrompt;
}

function spawnCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      shell: true,
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
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });

    proc.on('error', () => {
      resolve({ exitCode: 1, stdout, stderr });
    });
  });
}

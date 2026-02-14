import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { QuickCheckResult, QuickChecksOutput, ValidationIssue } from './types.js';
import { detectPackageManager, parseBuildErrors, runBuildValidation } from './build-validator.js';

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

  // Step 1: Typecheck
  const typecheckResult = await runTypecheckValidation(
    projectDir,
    options?.timeoutMs ?? DEFAULT_TYPECHECK_TIMEOUT_MS,
  );
  results.push(typecheckResult);

  // Step 2: Build — only if typecheck passed and build not skipped
  if (typecheckResult.passed && !options?.skipBuild) {
    const buildResult = await runBuildQuickCheck(projectDir, options?.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS);
    results.push(buildResult);
  }

  const passed = results.every((r) => r.passed);

  return {
    passed,
    results,
    agentRetryPrompt: passed ? null : formatForAgent(results),
    totalDurationMs: Date.now() - startTime,
  };
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
    // No typecheck available — pass through
    return {
      passed: true,
      phase: 'typecheck',
      issues: [],
      agentPrompt: null,
      durationMs: Date.now() - startTime,
    };
  }

  const { exitCode, stdout, stderr } = await spawnCommand(
    typecheckCmd.command,
    typecheckCmd.args,
    projectDir,
    timeoutMs,
  );

  if (exitCode === 0) {
    return {
      passed: true,
      phase: 'typecheck',
      issues: [],
      agentPrompt: null,
      durationMs: Date.now() - startTime,
    };
  }

  const output = stdout + stderr;
  const errors = parseTypecheckErrors(output);
  const issues: ValidationIssue[] = errors.map((error) => ({
    type: 'file' as const,
    severity: 'error' as const,
    message: `Type error: ${error}`,
    hint: 'Fix the type error and run typecheck again',
  }));

  // Fallback if no specific errors parsed
  if (issues.length === 0) {
    issues.push({
      type: 'file',
      severity: 'error',
      message: 'Typecheck failed',
      hint: `Run \`${typecheckCmd.command} ${typecheckCmd.args.join(' ')}\` to see full output`,
    });
  }

  const agentPrompt = formatTypecheckErrors(errors, output);

  return {
    passed: false,
    phase: 'typecheck',
    issues,
    agentPrompt,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Run build as a quick check, wrapping the existing runBuildValidation.
 */
async function runBuildQuickCheck(projectDir: string, timeoutMs: number): Promise<QuickCheckResult> {
  const buildResult = await runBuildValidation(projectDir, timeoutMs);

  return {
    passed: buildResult.success,
    phase: 'build',
    issues: buildResult.issues,
    agentPrompt: buildResult.success ? null : formatBuildErrors(buildResult.issues),
    durationMs: buildResult.durationMs,
  };
}

interface TypecheckCommand {
  command: string;
  args: string[];
}

/**
 * Detect the appropriate typecheck command for the project.
 * Checks for tsc in node_modules, then framework-specific alternatives.
 */
async function detectTypecheckCommand(projectDir: string): Promise<TypecheckCommand | null> {
  const pm = detectPackageManager(projectDir);

  // Check for typecheck script in package.json first
  try {
    const content = await readFile(join(projectDir, 'package.json'), 'utf-8');
    const pkg = JSON.parse(content) as { scripts?: Record<string, string> };

    if (pkg.scripts?.typecheck) {
      const args = pm === 'npm' ? ['run', 'typecheck'] : ['typecheck'];
      return { command: pm, args };
    }

    if (pkg.scripts?.['type-check']) {
      const args = pm === 'npm' ? ['run', 'type-check'] : ['type-check'];
      return { command: pm, args };
    }
  } catch {
    // No package.json or malformed — continue detection
  }

  // Only fall back to tsc if the project actually uses TypeScript
  try {
    await readFile(join(projectDir, 'tsconfig.json'), 'utf-8');
    return { command: 'npx', args: ['tsc', '--noEmit'] };
  } catch {
    // No tsconfig.json — not a TypeScript project, skip typecheck
    return null;
  }
}

/**
 * Parse TypeScript-specific errors from typecheck output.
 */
function parseTypecheckErrors(output: string): string[] {
  const errors: string[] = [];

  // TypeScript errors: "src/file.ts(line,col): error TS2345: ..."
  const tsErrors = output.match(/[\w./]+\.\w+\(\d+,\d+\):\s*error\s+TS\d+:.+/g);
  if (tsErrors) {
    errors.push(...tsErrors.slice(0, 10));
  }

  // Also match "src/file.ts:line:col - error TS2345: ..." (tsc --pretty format)
  const prettyErrors = output.match(/[\w./]+\.\w+:\d+:\d+\s*-\s*error\s+TS\d+:.+/g);
  if (prettyErrors) {
    // Dedupe with existing errors
    for (const err of prettyErrors.slice(0, 10)) {
      if (!errors.some((e) => e.includes(err.split(':')[0]))) {
        errors.push(err);
      }
    }
  }

  return errors.slice(0, 10);
}

/**
 * Format typecheck errors into an agent-ready prompt.
 * Turns "TS2345: Argument of type..." into actionable instructions.
 */
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

/**
 * Format build errors into an agent-ready prompt.
 */
function formatBuildErrors(issues: ValidationIssue[]): string {
  const errorMessages = issues.map((i) => `- ${i.message}`);
  return `The build failed:\n\n${errorMessages.join('\n')}\n\nFix these build errors.`;
}

/**
 * Format quick check failures into an agent-ready prompt.
 * Combines typecheck and build errors into a single actionable prompt.
 */
function formatForAgent(results: QuickCheckResult[]): string {
  const failedResults = results.filter((r) => !r.passed);
  if (failedResults.length === 0) return '';

  const parts: string[] = [];

  for (const result of failedResults) {
    if (result.agentPrompt) {
      parts.push(result.agentPrompt);
    }
  }

  return parts.join('\n\n');
}

/**
 * Spawn a command and collect output.
 */
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

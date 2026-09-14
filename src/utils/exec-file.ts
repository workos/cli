import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SPAWN_OPTS } from './platform.js';

export interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  /** Explicitly opt into a trusted project's working directory. */
  cwd?: string;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Execute a command without throwing on non-zero exit codes.
 * Defaults to a fresh directory so Windows shell lookup cannot execute a
 * repo-local shim, and host probes do not load project-local configuration.
 * Returns { status, stdout, stderr } for all outcomes.
 */
export async function execFileNoThrow(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  try {
    const isolatedCwd = options.cwd === undefined ? await mkdtemp(join(tmpdir(), 'workos-exec-')) : undefined;
    try {
      return await new Promise<ExecResult>((resolve) => {
        const child = spawn(command, args, {
          cwd: options.cwd ?? isolatedCwd,
          env: options.env ?? process.env,
          timeout: options.timeout,
          ...SPAWN_OPTS,
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('close', (code) => {
          resolve({
            status: code ?? 1,
            stdout,
            stderr,
          });
        });

        child.on('error', (err) => {
          resolve({
            status: 1,
            stdout,
            stderr: err.message,
          });
        });
      });
    } finally {
      if (isolatedCwd) await rm(isolatedCwd, { recursive: true, force: true, maxRetries: 3 });
    }
  } catch (error) {
    return { status: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
  }
}

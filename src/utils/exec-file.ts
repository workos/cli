import { spawn } from 'node:child_process';

export interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Execute a command without throwing on non-zero exit codes.
 * Returns { status, stdout, stderr } for all outcomes.
 */
export function execFileNoThrow(
  command: string,
  args: string[],
  options: ExecOptions = {}
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      timeout: options.timeout,
      shell: false,
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
}

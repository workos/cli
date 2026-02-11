import { execFileNoThrow } from '../../../src/utils/exec-file.js';
import type { GradeCheck } from '../types.js';

export class BuildGrader {
  constructor(protected workDir: string) {}

  async checkBuild(): Promise<GradeCheck> {
    const result = await execFileNoThrow('pnpm', ['build'], {
      cwd: this.workDir,
      timeout: 120000, // 2 minute timeout
    });

    if (result.status === 0) {
      return {
        name: 'Build succeeds',
        passed: true,
      };
    }

    return {
      name: 'Build succeeds',
      passed: false,
      message: `Build failed: ${result.stderr.slice(0, 500)}`,
    };
  }

  /**
   * Run an arbitrary command as a grading check.
   * Used for non-JS build/validation commands (e.g., go build, python -m py_compile, ruby -c).
   */
  async checkCommand(cmd: string, args: string[], name: string, timeout = 120000): Promise<GradeCheck> {
    const result = await execFileNoThrow(cmd, args, {
      cwd: this.workDir,
      timeout,
    });

    if (result.status === 0) {
      return { name, passed: true };
    }

    return {
      name,
      passed: false,
      message: `${cmd} ${args.join(' ')} failed: ${result.stderr.slice(0, 500)}`,
    };
  }

  async checkTypecheck(): Promise<GradeCheck> {
    const result = await execFileNoThrow('pnpm', ['tsc', '--noEmit'], {
      cwd: this.workDir,
      timeout: 60000,
    });

    if (result.status === 0) {
      return {
        name: 'Type check passes',
        passed: true,
      };
    }

    return {
      name: 'Type check passes',
      passed: false,
      message: `Type errors: ${result.stderr.slice(0, 500)}`,
    };
  }
}

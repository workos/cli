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

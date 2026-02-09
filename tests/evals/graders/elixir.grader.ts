import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * Elixir Grader
 *
 * SDK: workos (Hex)
 *
 * Key patterns:
 * - workos in mix.exs
 * - Auth controller exists
 * - mix compile passes
 */
export class ElixirGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const checks: GradeCheck[] = [];

    // Check workos in mix.exs
    checks.push(
      ...(await this.fileGrader.checkFileContains('mix.exs', ['workos'])),
    );

    // Check auth controller exists
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        'lib/**/*controller*.ex',
        [/auth|authorization|callback/i],
        'Auth controller exists',
      ),
    );

    // Check mix compile passes
    checks.push(
      await this.buildGrader.checkCommand('mix', ['compile'], 'mix compile'),
    );

    return {
      passed: checks.every((c) => c.passed),
      checks,
    };
  }
}

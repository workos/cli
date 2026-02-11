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
    const requiredChecks: GradeCheck[] = [];
    const bonusChecks: GradeCheck[] = [];

    // Required: workos in mix.exs
    requiredChecks.push(...(await this.fileGrader.checkFileContains('mix.exs', ['workos'])));

    // Required: auth controller exists
    requiredChecks.push(
      await this.fileGrader.checkFileWithPattern(
        'lib/**/*controller*.ex',
        [/auth|authorization|callback/i],
        'Auth controller exists',
      ),
    );

    // Required: mix compile passes
    requiredChecks.push(await this.buildGrader.checkCommand('mix', ['compile'], 'mix compile'));

    // Bonus: existing app routes preserved (proves agent read existing code)
    bonusChecks.push(
      await this.fileGrader.checkFileWithPattern(
        'lib/**/*.ex',
        [/api\/health/],
        'Existing app routes preserved',
      ),
    );

    const allChecks = [...requiredChecks, ...bonusChecks];
    return {
      passed: requiredChecks.every((c) => c.passed),
      checks: allChecks,
    };
  }
}

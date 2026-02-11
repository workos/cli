import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * PHP Grader
 *
 * SDK: workos (Composer)
 *
 * Key patterns:
 * - workos in composer.json
 * - Auth endpoint files exist
 */
export class PhpGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const requiredChecks: GradeCheck[] = [];
    const bonusChecks: GradeCheck[] = [];

    // Required: workos in composer.json
    requiredChecks.push(...(await this.fileGrader.checkFileContains('composer.json', ['workos'])));

    // Required: auth endpoint files exist
    requiredChecks.push(
      await this.fileGrader.checkFileWithPattern(
        '**/*.php',
        ['workos'],
        'Auth endpoint files contain WorkOS integration',
      ),
    );

    // Bonus: existing app routes preserved (proves agent read existing code)
    bonusChecks.push(
      await this.fileGrader.checkFileWithPattern(
        '**/*.php',
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

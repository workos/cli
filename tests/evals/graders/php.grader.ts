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
    const checks: GradeCheck[] = [];

    // Check workos in composer.json
    checks.push(
      ...(await this.fileGrader.checkFileContains('composer.json', ['workos'])),
    );

    // Check auth endpoint files exist
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        '**/*.php',
        ['workos'],
        'Auth endpoint files contain WorkOS integration',
      ),
    );

    return {
      passed: checks.every((c) => c.passed),
      checks,
    };
  }
}

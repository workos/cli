import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * PHP Laravel Grader
 *
 * SDK: workos (Composer, Laravel integration)
 *
 * Key patterns:
 * - workos in composer.json
 * - Auth controller exists
 * - Routes contain auth paths
 */
export class PhpLaravelGrader implements Grader {
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

    // Check auth controller exists
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        'app/Http/Controllers/**/*.php',
        ['workos'],
        'Auth controller exists with WorkOS integration',
      ),
    );

    // Check routes contain auth paths
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        'routes/**/*.php',
        [/auth|login|callback/],
        'Routes contain auth paths',
      ),
    );

    return {
      passed: checks.every((c) => c.passed),
      checks,
    };
  }
}

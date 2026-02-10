import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * PHP Laravel Grader
 *
 * SDK: workos (Composer, Laravel integration)
 *
 * Required checks (must pass):
 * - SDK in composer.json
 * - Auth controller or route with workos integration
 * - Routes contain auth paths
 *
 * The agent may put auth code in controllers, routes/web.php directly,
 * or a service provider — check broadly.
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
    checks.push(...(await this.fileGrader.checkFileContains('composer.json', ['workos'])));

    // Check auth integration exists somewhere in PHP files
    // Agent may put it in controllers, routes, or a service provider
    checks.push(await this.fileGrader.checkFileWithPattern('**/*.php', [/workos/i], 'WorkOS integration in PHP files'));

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

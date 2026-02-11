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
    const requiredChecks: GradeCheck[] = [];
    const bonusChecks: GradeCheck[] = [];

    // Required: workos in composer.json
    requiredChecks.push(...(await this.fileGrader.checkFileContains('composer.json', ['workos'])));

    // Required: auth integration exists somewhere in PHP files
    requiredChecks.push(await this.fileGrader.checkFileWithPattern('**/*.php', [/workos/i], 'WorkOS integration in PHP files'));

    // Required: routes contain auth paths
    requiredChecks.push(
      await this.fileGrader.checkFileWithPattern(
        'routes/**/*.php',
        [/auth|login|callback/],
        'Routes contain auth paths',
      ),
    );

    // Bonus: existing app routes preserved (proves agent read existing code)
    bonusChecks.push(
      await this.fileGrader.checkFileWithPattern(
        '{routes/**/*.php,**/*.php}',
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

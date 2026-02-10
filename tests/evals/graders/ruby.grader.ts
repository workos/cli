import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * Ruby Grader
 *
 * SDK: workos (RubyGems)
 *
 * Required checks (must pass):
 * - SDK installed in Gemfile
 * - Auth endpoints exist (login redirect + callback code exchange)
 *
 * Bonus checks (don't block pass):
 * - Sealed session handling (step 3 of quickstart)
 * - Syntax validation (requires Ruby runtime)
 */
export class RubyGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const requiredChecks: GradeCheck[] = [];
    const bonusChecks: GradeCheck[] = [];

    // Required: SDK in Gemfile
    requiredChecks.push(
      ...(await this.fileGrader.checkFileContains('Gemfile', ['workos'])),
    );

    // Required: sign-in endpoint
    requiredChecks.push(
      await this.fileGrader.checkFileWithPattern(
        '**/*.rb',
        [/authorization_url/],
        'Sign-in endpoint with authorization URL',
      ),
    );

    // Required: callback endpoint
    requiredChecks.push(
      await this.fileGrader.checkFileWithPattern(
        '**/*.rb',
        [/authenticate_with_code/],
        'Callback endpoint with code exchange',
      ),
    );

    // Bonus: sealed session handling
    bonusChecks.push(
      await this.fileGrader.checkFileWithPattern(
        '**/*.rb',
        [/load_sealed_session|seal_session|sealed_session/],
        'Sealed session handling (bonus)',
      ),
    );

    // Bonus: syntax check (requires Ruby)
    bonusChecks.push(
      await this.buildGrader.checkCommand('ruby', ['-c', 'server.rb'], 'Ruby syntax check (bonus)'),
    );

    const allChecks = [...requiredChecks, ...bonusChecks];
    return {
      passed: requiredChecks.every((c) => c.passed),
      checks: allChecks,
    };
  }
}

import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * Node.js Grader
 *
 * SDK: @workos-inc/node
 *
 * Required checks (must pass):
 * - SDK installed in package.json
 * - Auth endpoints exist (login redirect + callback code exchange)
 * - Syntax valid
 *
 * Bonus checks (don't block pass):
 * - Sealed session handling (step 3 of quickstart — agent may not get this far)
 */
export class NodeGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const requiredChecks: GradeCheck[] = [];
    const bonusChecks: GradeCheck[] = [];

    // Required: SDK in package.json
    requiredChecks.push(
      ...(await this.fileGrader.checkFileContains('package.json', ['@workos-inc/node'])),
    );

    // Required: sign-in endpoint (getAuthorizationUrl or authorizationUrl)
    requiredChecks.push(
      await this.fileGrader.checkFileWithPattern(
        '**/*.{js,ts}',
        [/getAuthorizationUrl|authorization_url|authorizationUrl/i],
        'Sign-in endpoint with authorization URL',
      ),
    );

    // Required: callback endpoint (authenticateWithCode)
    requiredChecks.push(
      await this.fileGrader.checkFileWithPattern(
        '**/*.{js,ts}',
        [/authenticateWithCode/],
        'Callback endpoint with code exchange',
      ),
    );

    // Required: syntax check
    requiredChecks.push(
      await this.buildGrader.checkCommand('node', ['--check', 'server.js'], 'node --check server.js'),
    );

    // Bonus: sealed session handling (step 3 of quickstart)
    bonusChecks.push(
      await this.fileGrader.checkFileWithPattern(
        '**/*.{js,ts}',
        [/loadSealedSession|sealSession|sealed_session/],
        'Sealed session handling (bonus)',
      ),
    );

    const allChecks = [...requiredChecks, ...bonusChecks];
    return {
      passed: requiredChecks.every((c) => c.passed),
      checks: allChecks,
    };
  }
}

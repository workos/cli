import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * SvelteKit Grader
 *
 * SDK: @workos/authkit-sveltekit (NOT @workos-inc)
 *
 * Required checks (must pass):
 * - AuthKit SDK in package.json
 * - hooks.server.ts exists with workos/authkit integration
 * - Callback route exists
 * - Build passes
 *
 * Bonus checks (don't block pass):
 * - Existing hooks preserved (Lucia handle / auth_session / sequence)
 * - sequence() used for hook composition
 * - WORKOS_COOKIE_PASSWORD in .env
 */
export class SvelteKitGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const requiredChecks: GradeCheck[] = [];
    const bonusChecks: GradeCheck[] = [];

    // Required: authkit-sveltekit in package.json (could be @workos/ or @workos-inc/)
    requiredChecks.push(
      await this.fileGrader.checkFileWithPattern(
        'package.json',
        [/authkit-sveltekit/],
        'AuthKit SvelteKit SDK in package.json',
      ),
    );

    // Required: hooks.server.ts exists with workos/authkit reference
    requiredChecks.push(
      await this.fileGrader.checkFileWithPattern(
        'src/hooks.server.ts',
        [/workos|authkit/i],
        'hooks.server.ts exists with AuthKit integration',
      ),
    );

    // Required: callback route exists (could be at various paths)
    requiredChecks.push(
      await this.fileGrader.checkFileWithPattern(
        'src/routes/**/+server.ts',
        [/workos|authkit|code|callback/i],
        'Callback route exists',
      ),
    );

    // Required: build passes
    requiredChecks.push(await this.buildGrader.checkBuild());

    // Bonus: existing hooks preserved (Lucia handle or auth_session cookie reference)
    bonusChecks.push(
      await this.fileGrader.checkFileWithPattern(
        'src/hooks.server.ts',
        [/lucia|auth_session|sequence/i],
        'Existing hooks preserved',
      ),
    );

    // Bonus: sequence() used for hook composition
    bonusChecks.push(
      await this.fileGrader.checkFileWithPattern(
        'src/hooks.server.ts',
        [/sequence/],
        'Hook composition via sequence()',
      ),
    );

    // Bonus: WORKOS_COOKIE_PASSWORD in .env
    bonusChecks.push(
      await this.fileGrader.checkFileWithPattern('.env*', [/WORKOS_COOKIE_PASSWORD/], 'WORKOS_COOKIE_PASSWORD in .env'),
    );

    const allChecks = [...requiredChecks, ...bonusChecks];
    return {
      passed: requiredChecks.every((c) => c.passed),
      checks: allChecks,
    };
  }
}

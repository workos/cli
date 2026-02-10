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
 */
export class SvelteKitGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const checks: GradeCheck[] = [];

    // Check authkit-sveltekit in package.json (could be @workos/ or @workos-inc/)
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        'package.json',
        [/authkit-sveltekit/],
        'AuthKit SvelteKit SDK in package.json',
      ),
    );

    // Check hooks.server.ts exists with workos/authkit reference
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        'src/hooks.server.ts',
        [/workos|authkit/i],
        'hooks.server.ts exists with AuthKit integration',
      ),
    );

    // Check callback route exists (could be at various paths)
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        'src/routes/**/+server.ts',
        [/workos|authkit|code|callback/i],
        'Callback route exists',
      ),
    );

    // Check build succeeds
    checks.push(await this.buildGrader.checkBuild());

    return {
      passed: checks.every((c) => c.passed),
      checks,
    };
  }
}

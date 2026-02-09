import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * SvelteKit Grader
 *
 * SDK: @workos-inc/authkit-sveltekit
 *
 * Key patterns:
 * - @workos-inc/authkit-sveltekit in package.json
 * - hooks.server.ts exists for server-side auth hooks
 * - Callback route exists for OAuth redirect
 * - pnpm build passes
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

    // Check @workos-inc/authkit-sveltekit in package.json
    checks.push(
      ...(await this.fileGrader.checkFileContains('package.json', ['@workos-inc/authkit-sveltekit'])),
    );

    // Check hooks.server.ts exists
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        'src/hooks.server.ts',
        ['@workos-inc/authkit-sveltekit'],
        'hooks.server.ts exists with AuthKit integration',
      ),
    );

    // Check callback route exists
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        'src/routes/**/+server.ts',
        ['@workos-inc/authkit-sveltekit'],
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

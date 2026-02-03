import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

export class NextjsGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const checks: GradeCheck[] = [];

    // Check callback route exists (path is configurable via WORKOS_REDIRECT_URI)
    const callbackCheck = await this.fileGrader.checkFileWithPattern(
      '**/route.ts',
      ['handleAuth', '@workos-inc/authkit-nextjs'],
      'AuthKit callback route',
    );
    checks.push(callbackCheck);

    // Check middleware exists
    checks.push(await this.fileGrader.checkFileExists('middleware.ts'));

    // Check middleware imports authkit
    checks.push(
      ...(await this.fileGrader.checkFileContains('middleware.ts', [
        '@workos-inc/authkit-nextjs',
        'authkitMiddleware',
      ])),
    );

    // Check AuthKitProvider in layout or extracted providers file
    const authKitProviderCheck = await this.fileGrader.checkFileWithPattern(
      'app/**/*.tsx',
      ['AuthKitProvider'],
      'AuthKitProvider in app',
    );
    checks.push(authKitProviderCheck);

    // Check build succeeds
    checks.push(await this.buildGrader.checkBuild());

    return {
      passed: checks.every((c) => c.passed),
      checks,
    };
  }
}

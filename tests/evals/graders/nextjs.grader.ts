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

    // Check middleware imports authkit SDK
    const sdkImportChecks = await this.fileGrader.checkFileContains('middleware.ts', ['@workos-inc/authkit-nextjs']);
    checks.push(...sdkImportChecks);

    // Check for authkit integration: authkitMiddleware OR (authkit + handleAuthkitHeaders)
    const middlewareChecks = await this.fileGrader.checkFileContains('middleware.ts', ['authkitMiddleware']);
    const composableChecks = await this.fileGrader.checkFileContains('middleware.ts', [
      'authkit(',
      'handleAuthkitHeaders',
    ]);

    const usesAuthkitMiddleware = middlewareChecks.every((c) => c.passed);
    const usesComposable = composableChecks.every((c) => c.passed);

    const authkitCheck: GradeCheck = {
      name: 'AuthKit middleware integration',
      passed: usesAuthkitMiddleware || usesComposable,
      message: usesAuthkitMiddleware
        ? 'Uses authkitMiddleware'
        : usesComposable
          ? 'Uses authkit() composable with handleAuthkitHeaders'
          : 'Missing authkitMiddleware or authkit() composable integration',
    };
    checks.push(authkitCheck);

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

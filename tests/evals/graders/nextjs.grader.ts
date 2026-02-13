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

    // Check middleware or proxy exists (Next.js 16+ may use proxy.ts if no middleware.ts existed)
    const middlewareExists = await this.fileGrader.checkFileExists('middleware.ts');
    const proxyExists = await this.fileGrader.checkFileExists('proxy.ts');
    const middlewareFile = middlewareExists.passed ? 'middleware.ts' : 'proxy.ts';

    checks.push({
      name: 'AuthKit middleware/proxy file exists',
      passed: middlewareExists.passed || proxyExists.passed,
      message: middlewareExists.passed
        ? 'middleware.ts exists'
        : proxyExists.passed
          ? 'proxy.ts exists'
          : 'Neither middleware.ts nor proxy.ts found',
    });

    // If both exist, warn — middleware.ts takes precedence and proxy.ts is ignored
    if (middlewareExists.passed && proxyExists.passed) {
      const proxyHasAuthkit = await this.fileGrader.checkFileContains('proxy.ts', ['@workos-inc/authkit-nextjs']);
      const middlewareHasAuthkit = await this.fileGrader.checkFileContains('middleware.ts', ['@workos-inc/authkit-nextjs']);
      if (proxyHasAuthkit.some((c) => c.passed) && !middlewareHasAuthkit.some((c) => c.passed)) {
        checks.push({
          name: 'AuthKit middleware conflict',
          passed: false,
          message: 'AuthKit is in proxy.ts but middleware.ts also exists — Next.js ignores proxy.ts when middleware.ts is present',
        });
      }
    }

    // Check middleware/proxy imports authkit SDK
    const sdkImportChecks = await this.fileGrader.checkFileContains(middlewareFile, ['@workos-inc/authkit-nextjs']);
    checks.push(...sdkImportChecks);

    // Check for authkit integration: authkitMiddleware OR (authkit + handleAuthkitHeaders)
    const middlewareChecks = await this.fileGrader.checkFileContains(middlewareFile, ['authkitMiddleware']);
    const composableChecks = await this.fileGrader.checkFileContains(middlewareFile, [
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

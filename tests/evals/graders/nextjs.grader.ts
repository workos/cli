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

    // Check middleware or proxy exists at root or src/ (Next.js 16+ should use proxy.ts, 13-15 use middleware.ts)
    const middlewareRoot = await this.fileGrader.checkFileExists('middleware.ts');
    const middlewareSrc = await this.fileGrader.checkFileExists('src/middleware.ts');
    const proxyRoot = await this.fileGrader.checkFileExists('proxy.ts');
    const proxySrc = await this.fileGrader.checkFileExists('src/proxy.ts');

    const middlewareExists = middlewareRoot.passed || middlewareSrc.passed;
    const proxyExists = proxyRoot.passed || proxySrc.passed;

    // Determine which file to check for authkit content
    let middlewareFile: string;
    if (proxyRoot.passed) middlewareFile = 'proxy.ts';
    else if (proxySrc.passed) middlewareFile = 'src/proxy.ts';
    else if (middlewareSrc.passed) middlewareFile = 'src/middleware.ts';
    else middlewareFile = 'middleware.ts';

    checks.push({
      name: 'AuthKit middleware/proxy file exists',
      passed: middlewareExists || proxyExists,
      message: middlewareExists
        ? `middleware.ts exists${middlewareSrc.passed ? ' (src/)' : ''}`
        : proxyExists
          ? `proxy.ts exists${proxySrc.passed ? ' (src/)' : ''}`
          : 'Neither middleware.ts nor proxy.ts found',
    });

    // Next.js 16 throws error E900 if both middleware.ts and proxy.ts exist
    if (middlewareExists && proxyExists) {
      checks.push({
        name: 'No middleware/proxy conflict',
        passed: false,
        message:
          'Both middleware.ts and proxy.ts exist — Next.js 16 throws an error when both are present. Delete middleware.ts and use only proxy.ts.',
      });
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

    // Check AuthKitProvider in layout or extracted providers file (app/ may be in src/)
    const authKitProviderCheck = await this.fileGrader.checkFileWithPattern(
      '{app,src/app}/**/*.tsx',
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

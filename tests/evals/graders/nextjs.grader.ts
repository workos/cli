import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';
import {
  findUnsafeGetSignInUrlUsage,
  hasTopLevelDirective,
} from '../../../src/lib/validation/server-component-detect.js';

export { hasTopLevelDirective, findUnsafeGetSignInUrlUsage };

export class NextjsGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;
  private workDir: string;

  constructor(workDir: string) {
    this.workDir = workDir;
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
    const [middlewareRoot, middlewareSrc, proxyRoot, proxySrc] = await Promise.all([
      this.fileGrader.checkFileExists('middleware.ts'),
      this.fileGrader.checkFileExists('src/middleware.ts'),
      this.fileGrader.checkFileExists('proxy.ts'),
      this.fileGrader.checkFileExists('src/proxy.ts'),
    ]);

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

    checks.push(...(await this.checkAuthkitIntegration(middlewareFile)));

    // Check AuthKitProvider in layout or extracted providers file (app/ may be in src/)
    const authKitProviderCheck = await this.fileGrader.checkFileWithPattern(
      '{app,src/app}/**/*.tsx',
      ['AuthKitProvider'],
      'AuthKitProvider in app',
    );
    checks.push(authKitProviderCheck);

    const unsafeFiles = await findUnsafeGetSignInUrlUsage(this.workDir);
    checks.push({
      name: 'No getSignInUrl in Server Components',
      passed: unsafeFiles.length === 0,
      message:
        unsafeFiles.length > 0
          ? `${unsafeFiles[0]} calls getSignInUrl() without a top-level 'use client' or 'use server' directive — will throw in Next.js 15+`
          : 'No unsafe getSignInUrl usage in Server Components',
    });

    checks.push(await this.buildGrader.checkBuild());

    return {
      passed: checks.every((c) => c.passed),
      checks,
    };
  }

  /**
   * The SDK exports three valid entry points for the middleware/proxy file:
   *   - authkitProxy       (Next.js 16+ preferred, used in proxy.ts)
   *   - authkitMiddleware  (deprecated alias for authkitProxy, still works)
   *   - authkit() + handleAuthkitHeaders (composable for custom middleware)
   */
  private async checkAuthkitIntegration(middlewareFile: string): Promise<GradeCheck[]> {
    let content: string;
    try {
      content = await readFile(join(this.workDir, middlewareFile), 'utf-8');
    } catch {
      return [
        {
          name: `Pattern in ${middlewareFile}: @workos-inc/authkit-nextjs`,
          passed: false,
          message: `Cannot read file: ${middlewareFile}`,
        },
        {
          name: 'AuthKit middleware integration',
          passed: false,
          message: `Cannot read file: ${middlewareFile}`,
        },
      ];
    }

    const hasSdkImport = content.includes('@workos-inc/authkit-nextjs');
    const usesAuthkitProxy = content.includes('authkitProxy');
    const usesAuthkitMiddleware = content.includes('authkitMiddleware');
    const usesComposable = content.includes('authkit(') && content.includes('handleAuthkitHeaders');

    const integrationMessage =
      usesAuthkitProxy ? 'Uses authkitProxy'
      : usesAuthkitMiddleware ? 'Uses authkitMiddleware (deprecated; prefer authkitProxy)'
      : usesComposable ? 'Uses authkit() composable with handleAuthkitHeaders'
      : 'Missing authkitProxy, authkitMiddleware, or authkit() composable integration';

    return [
      {
        name: `Pattern in ${middlewareFile}: @workos-inc/authkit-nextjs`,
        passed: hasSdkImport,
        message: hasSdkImport ? undefined : 'Pattern not found: @workos-inc/authkit-nextjs',
      },
      {
        name: 'AuthKit middleware integration',
        passed: usesAuthkitProxy || usesAuthkitMiddleware || usesComposable,
        message: integrationMessage,
      },
    ];
  }
}

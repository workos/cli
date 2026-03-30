import fg from 'fast-glob';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * Module prologue directive check.
 * Only matches 'use client' / 'use server' when they appear as the
 * first statement in the file (ignoring leading comments and whitespace).
 * Does NOT match inline 'use server' inside function bodies.
 */
export function hasTopLevelDirective(content: string, directive: string): boolean {
  // Strip leading whitespace, single-line comments, and multi-line comments
  const stripped = content.replace(/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/g, '');
  // Check if the file starts with the directive (single or double quotes, with semicolon optional)
  return stripped.startsWith(`'${directive}'`) || stripped.startsWith(`"${directive}"`);
}

const INVOCATION_PATTERN = /\bgetSignInUrl\s*\(/;

/**
 * Strip single-line (//) and multi-line comments from source code
 * so the invocation regex doesn't match commented-out calls.
 */
function stripComments(content: string): string {
  return content.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
}

export async function findUnsafeGetSignInUrlUsage(workDir: string): Promise<{ file: string } | null> {
  const files = await fg('{app,src/app}/**/*.tsx', {
    cwd: workDir,
    ignore: ['**/callback/**', '**/node_modules/**'],
    absolute: true,
  });

  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const code = stripComments(content);

    if (
      INVOCATION_PATTERN.test(code) &&
      !hasTopLevelDirective(content, 'use client') &&
      !hasTopLevelDirective(content, 'use server')
    ) {
      return { file: relative(workDir, file) };
    }
  }

  return null;
}

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

    // Check for getSignInUrl() in server components (no top-level directive)
    const unsafeUsage = await findUnsafeGetSignInUrlUsage(this.workDir);
    checks.push({
      name: 'No getSignInUrl in Server Components',
      passed: unsafeUsage === null,
      message: unsafeUsage
        ? `${unsafeUsage.file} calls getSignInUrl() without a top-level 'use client' or 'use server' directive — will throw in Next.js 15+`
        : 'No unsafe getSignInUrl usage in Server Components',
    });

    // Check build succeeds
    checks.push(await this.buildGrader.checkBuild());

    return {
      passed: checks.every((c) => c.passed),
      checks,
    };
  }
}

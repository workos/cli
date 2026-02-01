import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * TanStack Start Grader
 *
 * SDK: @workos/authkit-tanstack-react-start
 * Docs: https://github.com/workos/authkit-tanstack-start
 *
 * Key patterns:
 * - Directory: src/ (v1.132+) or app/ (legacy)
 * - Middleware: authkitMiddleware() in start.ts
 * - Callback: handleCallbackRoute() in api/auth/callback route
 * - Provider: AuthKitProvider is OPTIONAL (only for client hooks)
 */
export class TanstackGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const checks: GradeCheck[] = [];

    // Check middleware setup (CRITICAL - required for auth to work)
    // Can be in src/start.ts, app/start.ts, or router files
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        '{src,app}/**/*.{ts,tsx}',
        ['authkitMiddleware', '@workos/authkit-tanstack-react-start'],
        'authkitMiddleware configured with correct SDK',
      ),
    );

    // Check callback route exists with handleCallbackRoute
    // Supports both nested (api/auth/callback.tsx) and flat (api.auth.callback.tsx) route patterns
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        '{src,app}/routes/**/*callback*.tsx',
        ['handleCallbackRoute', '@workos/authkit-tanstack-react-start'],
        'Callback route with handleCallbackRoute',
      ),
    );

    // Check for auth usage (getAuth, signOut, etc.) somewhere in routes
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        '{src,app}/routes/**/*.tsx',
        [/@workos\/authkit-tanstack-react-start/],
        'SDK usage in routes',
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

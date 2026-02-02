import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * React Router Grader
 *
 * SDK: @workos-inc/authkit-react-router
 * Docs: https://github.com/workos/authkit-react-router
 *
 * Key patterns:
 * - authLoader() for OAuth callback route
 * - authkitLoader() for routes needing auth state
 * - Supports v6, v7 Framework, v7 Data, v7 Declarative modes
 * - Callback route path must match WORKOS_REDIRECT_URI
 * - No ProtectedRoute needed - SDK has ensureSignedIn option
 */
export class ReactRouterGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const checks: GradeCheck[] = [];

    // Check callback route with authLoader
    // Supports various patterns: auth.callback.tsx, callback.tsx, auth/callback.tsx
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        '{app,src}/routes/**/*callback*.{ts,tsx}',
        ['authLoader', '@workos-inc/authkit-react-router'],
        'Callback route with authLoader',
      ),
    );

    // Check authkitLoader usage in some route for auth state
    // Can be root route (app/root.tsx in Framework mode) or any protected route
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        '{app,src}/{root,routes/**/*}.{ts,tsx}',
        ['authkitLoader', '@workos-inc/authkit-react-router'],
        'authkitLoader for auth state in routes',
      ),
    );

    // Check SDK usage somewhere in the app (flexible - imports from SDK)
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        '{app,src}/**/*.{ts,tsx}',
        [/@workos-inc\/authkit-react-router/],
        'SDK integration',
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

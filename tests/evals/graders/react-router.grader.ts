import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

export class ReactRouterGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const checks: GradeCheck[] = [];

    // Check auth route/loader exists (v7 flat routes style)
    const v7RouteExists = await this.fileGrader.checkFileExists('app/routes/auth.callback.tsx');
    if (!v7RouteExists.passed) {
      // Try v6 nested style
      const v6RouteExists = await this.fileGrader.checkFileExists('src/routes/callback.tsx');
      if (!v6RouteExists.passed) {
        // Try alternate v7 pattern
        checks.push(await this.fileGrader.checkFileExists('app/routes/callback.tsx'));
      } else {
        checks.push(v6RouteExists);
      }
    } else {
      checks.push(v7RouteExists);
    }

    // Check loader/action for auth - try multiple possible locations
    const authRoutePatterns = await this.checkAuthRoute();
    checks.push(...authRoutePatterns);

    // Check protected route wrapper or middleware
    const hasProtectedRoute = await this.fileGrader.checkFileExists(
      'app/components/ProtectedRoute.tsx'
    );
    if (!hasProtectedRoute.passed) {
      // Try alternate locations
      checks.push(await this.fileGrader.checkFileExists('app/utils/auth.ts'));
    } else {
      checks.push(hasProtectedRoute);
    }

    // Check build succeeds
    checks.push(await this.buildGrader.checkBuild());

    return {
      passed: checks.every((c) => c.passed),
      checks,
    };
  }

  private async checkAuthRoute(): Promise<GradeCheck[]> {
    // Try v7 flat routes first
    const v7Checks = await this.fileGrader.checkFileContains('app/routes/auth.callback.tsx', [
      'loader',
      '@workos-inc/authkit',
    ]);

    if (v7Checks.every((c) => c.passed)) {
      return v7Checks;
    }

    // Try alternate callback location
    const altChecks = await this.fileGrader.checkFileContains('app/routes/callback.tsx', [
      'loader',
      '@workos-inc/authkit',
    ]);

    if (altChecks.every((c) => c.passed)) {
      return altChecks;
    }

    // Return the v7 checks as the expected pattern
    return v7Checks;
  }
}

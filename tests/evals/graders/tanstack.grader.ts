import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

export class TanstackGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const checks: GradeCheck[] = [];

    // Check auth callback route
    const callbackRoute = await this.fileGrader.checkFileExists('app/routes/auth/callback.tsx');
    if (!callbackRoute.passed) {
      // Try alternate pattern
      checks.push(await this.fileGrader.checkFileExists('app/routes/callback.tsx'));
    } else {
      checks.push(callbackRoute);
    }

    // Check server functions for auth
    const serverAuth = await this.fileGrader.checkFileExists('app/server/auth.ts');
    if (!serverAuth.passed) {
      // Try alternate locations
      checks.push(await this.fileGrader.checkFileExists('app/lib/auth.ts'));
    } else {
      checks.push(serverAuth);
    }

    // Check auth server function content
    const authContent = await this.checkAuthServerContent();
    checks.push(...authContent);

    // Check provider setup in root
    const rootProviderChecks = await this.fileGrader.checkFileContains('app/routes/__root.tsx', [
      'AuthKitProvider',
    ]);
    if (!rootProviderChecks.every((c) => c.passed)) {
      // Try alternate root location
      checks.push(
        ...(await this.fileGrader.checkFileContains('app/root.tsx', ['AuthKitProvider']))
      );
    } else {
      checks.push(...rootProviderChecks);
    }

    // Check build succeeds
    checks.push(await this.buildGrader.checkBuild());

    return {
      passed: checks.every((c) => c.passed),
      checks,
    };
  }

  private async checkAuthServerContent(): Promise<GradeCheck[]> {
    // Try primary location
    const primaryChecks = await this.fileGrader.checkFileContains('app/server/auth.ts', [
      '@workos-inc/authkit',
      'createServerFn',
    ]);

    if (primaryChecks.every((c) => c.passed)) {
      return primaryChecks;
    }

    // Try alternate location
    return this.fileGrader.checkFileContains('app/lib/auth.ts', [
      '@workos-inc/authkit',
      'createServerFn',
    ]);
  }
}

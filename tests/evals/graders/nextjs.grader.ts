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

    // Check callback route exists (App Router)
    checks.push(
      await this.fileGrader.checkFileExists('app/api/auth/callback/route.ts')
    );

    // Check middleware exists
    checks.push(await this.fileGrader.checkFileExists('middleware.ts'));

    // Check middleware imports authkit
    checks.push(
      ...(await this.fileGrader.checkFileContains('middleware.ts', [
        '@workos-inc/authkit-nextjs',
        'authkitMiddleware',
      ]))
    );

    // Check AuthKitProvider in layout
    checks.push(
      ...(await this.fileGrader.checkFileContains('app/layout.tsx', [
        'AuthKitProvider',
      ]))
    );

    // Check environment variables used correctly
    checks.push(
      ...(await this.fileGrader.checkFileContains('middleware.ts', [
        /process\.env\.WORKOS_/,
      ]))
    );

    // Check build succeeds
    checks.push(await this.buildGrader.checkBuild());

    return {
      passed: checks.every((c) => c.passed),
      checks,
    };
  }
}

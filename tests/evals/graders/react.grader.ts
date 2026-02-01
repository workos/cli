import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

export class ReactGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const checks: GradeCheck[] = [];

    // Check AuthKitProvider wrapper exists
    checks.push(
      ...(await this.fileGrader.checkFileContains('src/main.tsx', ['AuthKitProvider', '@workos-inc/authkit-react'])),
    );

    // Check callback component exists
    const callbackExists = await this.fileGrader.checkFileExists('src/pages/callback.tsx');
    if (!callbackExists.passed) {
      // Try alternate location
      checks.push(await this.fileGrader.checkFileExists('src/components/Callback.tsx'));
    } else {
      checks.push(callbackExists);
    }

    // Check useAuth hook usage somewhere
    checks.push(...(await this.fileGrader.checkFileContains('src/App.tsx', ['useAuth'])));

    // Check environment config
    checks.push(
      ...(await this.fileGrader.checkFileContains('src/main.tsx', [/VITE_WORKOS_CLIENT_ID|import\.meta\.env/])),
    );

    // Check build succeeds
    checks.push(await this.buildGrader.checkBuild());

    return {
      passed: checks.every((c) => c.passed),
      checks,
    };
  }
}

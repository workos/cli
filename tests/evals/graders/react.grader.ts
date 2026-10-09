import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * React SPA Grader
 *
 * SDK: @workos-inc/authkit-react
 * Docs: https://github.com/workos/authkit-react
 *
 * Key patterns:
 * - AuthKitProvider wraps app in entry file (main.tsx or index.tsx)
 * - useAuth hook used in any component for auth state
 * - NO callback route needed - SDK handles OAuth internally
 * - Environment vars: VITE_WORKOS_CLIENT_ID (Vite) or REACT_APP_WORKOS_CLIENT_ID (CRA)
 */
export class ReactGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const checks: GradeCheck[] = [];

    // AuthKitProvider may live in the entry file or an app-owned provider module
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        'src/**/*.tsx',
        ['AuthKitProvider', '@workos-inc/authkit-react'],
        'AuthKitProvider configured with correct SDK',
      ),
    );

    // Check useAuth hook usage somewhere in the app
    // Can be in App.tsx, pages/, components/, or anywhere
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        'src/**/*.tsx',
        ['useAuth', '@workos-inc/authkit-react'],
        'useAuth hook usage',
      ),
    );

    // Env config is read where AuthKitProvider is configured
    // Supports both Vite (import.meta.env) and CRA (process.env)
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        'src/**/*.tsx',
        ['AuthKitProvider', /VITE_WORKOS_CLIENT_ID|REACT_APP_WORKOS_CLIENT_ID|import\.meta\.env|process\.env/],
        'Environment variable configuration',
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

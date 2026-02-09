import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * Ruby Grader
 *
 * SDK: workos (RubyGems)
 *
 * Key patterns:
 * - workos in Gemfile
 * - server.rb contains authorization_url, authenticate_with_code, load_sealed_session
 * - ruby -c server.rb passes syntax validation
 */
export class RubyGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const checks: GradeCheck[] = [];

    // Check workos in Gemfile
    checks.push(
      ...(await this.fileGrader.checkFileContains('Gemfile', ['workos'])),
    );

    // Check server.rb contains required auth functions
    checks.push(
      ...(await this.fileGrader.checkFileContains('server.rb', [
        'authorization_url',
        'authenticate_with_code',
        'load_sealed_session',
      ])),
    );

    // Check ruby -c server.rb passes syntax check
    checks.push(
      await this.buildGrader.checkCommand('ruby', ['-c', 'server.rb'], 'ruby -c server.rb'),
    );

    return {
      passed: checks.every((c) => c.passed),
      checks,
    };
  }
}

import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * Node.js Grader
 *
 * SDK: @workos-inc/node
 *
 * Key patterns:
 * - @workos-inc/node in package.json
 * - server.js contains getAuthorizationUrl, authenticateWithCode, loadSealedSession
 * - node --check server.js passes syntax validation
 */
export class NodeGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const checks: GradeCheck[] = [];

    // Check @workos-inc/node in package.json
    checks.push(
      ...(await this.fileGrader.checkFileContains('package.json', ['@workos-inc/node'])),
    );

    // Check server.js contains required auth functions
    checks.push(
      ...(await this.fileGrader.checkFileContains('server.js', [
        'getAuthorizationUrl',
        'authenticateWithCode',
        'loadSealedSession',
      ])),
    );

    // Check node --check server.js passes
    checks.push(
      await this.buildGrader.checkCommand('node', ['--check', 'server.js'], 'node --check server.js'),
    );

    return {
      passed: checks.every((c) => c.passed),
      checks,
    };
  }
}

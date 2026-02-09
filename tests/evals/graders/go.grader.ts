import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * Go Grader
 *
 * SDK: workos (Go module)
 *
 * Key patterns:
 * - workos in go.mod
 * - go build ./... passes
 * - go vet ./... passes
 */
export class GoGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const checks: GradeCheck[] = [];

    // Check workos in go.mod
    checks.push(
      ...(await this.fileGrader.checkFileContains('go.mod', ['workos'])),
    );

    // Check go build ./... passes
    checks.push(
      await this.buildGrader.checkCommand('go', ['build', './...'], 'go build ./...'),
    );

    // Check go vet ./... passes
    checks.push(
      await this.buildGrader.checkCommand('go', ['vet', './...'], 'go vet ./...'),
    );

    return {
      passed: checks.every((c) => c.passed),
      checks,
    };
  }
}

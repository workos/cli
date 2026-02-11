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
    const requiredChecks: GradeCheck[] = [];
    const bonusChecks: GradeCheck[] = [];

    // Required: workos in go.mod
    requiredChecks.push(...(await this.fileGrader.checkFileContains('go.mod', ['workos'])));

    // Required: go build ./... passes
    requiredChecks.push(await this.buildGrader.checkCommand('go', ['build', './...'], 'go build ./...'));

    // Required: go vet ./... passes
    requiredChecks.push(await this.buildGrader.checkCommand('go', ['vet', './...'], 'go vet ./...'));

    // Bonus: existing app routes preserved (proves agent read existing code)
    bonusChecks.push(
      await this.fileGrader.checkFileWithPattern(
        '**/*.go',
        [/api\/health/],
        'Existing app routes preserved',
      ),
    );

    const allChecks = [...requiredChecks, ...bonusChecks];
    return {
      passed: requiredChecks.every((c) => c.passed),
      checks: allChecks,
    };
  }
}

import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * .NET Grader
 *
 * SDK: WorkOS (NuGet)
 *
 * Key patterns:
 * - WorkOS in *.csproj
 * - Program.cs contains auth routes
 * - dotnet build passes
 */
export class DotnetGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const checks: GradeCheck[] = [];

    // Check WorkOS in *.csproj
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        '**/*.csproj',
        ['WorkOS'],
        'WorkOS package reference in .csproj',
      ),
    );

    // Check Program.cs contains auth routes
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        '**/Program.cs',
        [/auth|authorization|callback/i],
        'Program.cs contains auth routes',
      ),
    );

    // Check dotnet build passes
    checks.push(
      await this.buildGrader.checkCommand('dotnet', ['build'], 'dotnet build'),
    );

    return {
      passed: checks.every((c) => c.passed),
      checks,
    };
  }
}

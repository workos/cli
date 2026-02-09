import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * Kotlin Grader
 *
 * SDK: workos (Gradle)
 *
 * Key patterns:
 * - workos in build.gradle.kts
 * - ./gradlew build passes (180s timeout for JVM cold start)
 */
export class KotlinGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const checks: GradeCheck[] = [];

    // Check workos in build.gradle.kts
    checks.push(
      ...(await this.fileGrader.checkFileContains('build.gradle.kts', ['workos'])),
    );

    // Check ./gradlew build passes (180s timeout for JVM cold start)
    checks.push(
      await this.buildGrader.checkCommand('./gradlew', ['build'], './gradlew build', 180000),
    );

    return {
      passed: checks.every((c) => c.passed),
      checks,
    };
  }
}

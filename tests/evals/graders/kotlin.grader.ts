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
    const requiredChecks: GradeCheck[] = [];
    const bonusChecks: GradeCheck[] = [];

    // Required: workos in build.gradle.kts
    requiredChecks.push(...(await this.fileGrader.checkFileContains('build.gradle.kts', ['workos'])));

    // Required: ./gradlew build passes (180s timeout for JVM cold start)
    requiredChecks.push(await this.buildGrader.checkCommand('./gradlew', ['build'], './gradlew build', 180000));

    // Bonus: existing app routes preserved (proves agent read existing code)
    bonusChecks.push(
      await this.fileGrader.checkFileWithPattern('**/*.kt', [/api\/health/], 'Existing app routes preserved'),
    );

    const allChecks = [...requiredChecks, ...bonusChecks];
    return {
      passed: requiredChecks.every((c) => c.passed),
      checks: allChecks,
    };
  }
}

import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * Python Grader
 *
 * SDK: workos (PyPI)
 *
 * Required checks (must pass):
 * - SDK installed in requirements.txt or pyproject.toml
 * - Auth endpoints exist (login redirect + callback code exchange)
 *
 * Bonus checks (don't block pass):
 * - Sealed session handling (step 3 of quickstart)
 * - Syntax validation (requires Python runtime)
 */
export class PythonGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const requiredChecks: GradeCheck[] = [];
    const bonusChecks: GradeCheck[] = [];

    // Required: SDK in deps (requirements.txt or pyproject.toml)
    const reqTxt = await this.fileGrader.checkFileWithPattern(
      '{requirements*.txt,pyproject.toml}',
      ['workos'],
      'WorkOS SDK in dependencies',
    );
    requiredChecks.push(reqTxt);

    // Required: sign-in endpoint
    requiredChecks.push(
      await this.fileGrader.checkFileWithPattern(
        '**/*.py',
        [/get_authorization_url|authorization_url/],
        'Sign-in endpoint with authorization URL',
      ),
    );

    // Required: callback endpoint
    requiredChecks.push(
      await this.fileGrader.checkFileWithPattern(
        '**/*.py',
        [/authenticate_with_code/],
        'Callback endpoint with code exchange',
      ),
    );

    // Bonus: existing app routes preserved (proves agent read existing code)
    bonusChecks.push(
      await this.fileGrader.checkFileWithPattern('**/*.py', [/api\/health/], 'Existing app routes preserved'),
    );

    // Bonus: sealed session handling
    bonusChecks.push(
      await this.fileGrader.checkFileWithPattern(
        '**/*.py',
        [/load_sealed_session|seal_session|sealed_session/],
        'Sealed session handling (bonus)',
      ),
    );

    // Bonus: syntax check (requires Python)
    bonusChecks.push(
      await this.buildGrader.checkCommand('python3', ['-m', 'py_compile', 'server.py'], 'Python syntax check (bonus)'),
    );

    const allChecks = [...requiredChecks, ...bonusChecks];
    return {
      passed: requiredChecks.every((c) => c.passed),
      checks: allChecks,
    };
  }
}

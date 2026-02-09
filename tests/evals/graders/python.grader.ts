import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * Python Grader
 *
 * SDK: workos (PyPI)
 *
 * Key patterns:
 * - workos in requirements.txt
 * - server.py contains get_authorization_url, authenticate_with_code, load_sealed_session
 * - python -m py_compile server.py passes syntax validation
 */
export class PythonGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const checks: GradeCheck[] = [];

    // Check workos in requirements.txt
    checks.push(
      ...(await this.fileGrader.checkFileContains('requirements.txt', ['workos'])),
    );

    // Check server.py contains required auth functions
    checks.push(
      ...(await this.fileGrader.checkFileContains('server.py', [
        'get_authorization_url',
        'authenticate_with_code',
        'load_sealed_session',
      ])),
    );

    // Check python -m py_compile server.py passes
    checks.push(
      await this.buildGrader.checkCommand(
        'python',
        ['-m', 'py_compile', 'server.py'],
        'python -m py_compile server.py',
      ),
    );

    return {
      passed: checks.every((c) => c.passed),
      checks,
    };
  }
}

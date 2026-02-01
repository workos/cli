import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

export class VanillaGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;
  private workDir: string;

  constructor(workDir: string) {
    this.workDir = workDir;
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const checks: GradeCheck[] = [];

    // Check callback page exists
    const callbackHtml = await this.fileGrader.checkFileExists('callback.html');
    const callbackJs = await this.fileGrader.checkFileExists('callback.js');
    checks.push(callbackHtml.passed ? callbackHtml : callbackJs);

    // Check auth script
    checks.push(await this.fileGrader.checkFileExists('auth.js'));

    // Check auth script content
    checks.push(...(await this.fileGrader.checkFileContains('auth.js', ['workos', 'getAuthorizationUrl'])));

    // Check index.html includes auth
    checks.push(...(await this.fileGrader.checkFileContains('index.html', [/auth\.js|workos/i])));

    // Vanilla JS may not have build step - check if build script exists
    const hasBuildScript = await this.checkHasBuildScript();
    if (hasBuildScript) {
      checks.push(await this.buildGrader.checkBuild());
    }

    return {
      passed: checks.every((c) => c.passed),
      checks,
    };
  }

  private async checkHasBuildScript(): Promise<boolean> {
    try {
      const pkgPath = join(this.workDir, 'package.json');
      const content = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      return !!pkg.scripts?.build;
    } catch {
      return false;
    }
  }
}

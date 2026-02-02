import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * Vanilla JS Grader
 *
 * SDK: @workos-inc/authkit-js
 * Docs: https://github.com/workos/authkit-js
 *
 * Key patterns:
 * - Bundled: import { createClient } from '@workos-inc/authkit-js'
 * - CDN: WorkOS.createClient from script tag
 * - Async init: const authkit = await createClient(clientId)
 * - Methods: authkit.signIn(), authkit.signOut(), authkit.getUser()
 * - NO callback route needed - SDK handles OAuth internally
 */
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

    // Check SDK integration - either bundled import or CDN script
    // Bundled: import from '@workos-inc/authkit-js'
    // CDN: WorkOS.createClient
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        '**/*.{js,ts,html}',
        [/@workos-inc\/authkit-js|WorkOS\.createClient|workos.*createClient/i],
        'AuthKit JS SDK integration',
      ),
    );

    // Check createClient usage (the core initialization pattern)
    checks.push(
      await this.fileGrader.checkFileWithPattern('**/*.{js,ts}', ['createClient'], 'createClient initialization'),
    );

    // Check for auth methods usage (signIn, signOut, or getUser)
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        '**/*.{js,ts}',
        [/signIn|signOut|getUser|getAccessToken/],
        'Auth method usage',
      ),
    );

    // Check index.html exists and references auth script or module
    checks.push(await this.fileGrader.checkFileWithPattern('*.html', [/<script/i], 'HTML with script reference'));

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

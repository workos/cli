import fg from 'fast-glob';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { FileGrader } from './file-grader.js';
import { BuildGrader } from './build-grader.js';
import type { Grader, GradeResult, GradeCheck } from '../types.js';

/**
 * React SPA Grader
 *
 * SDK: @workos-inc/authkit-react
 * Docs: https://github.com/workos/authkit-react
 *
 * Key patterns:
 * - AuthKitProvider wraps app in entry file (main.tsx or index.tsx)
 * - useAuth hook used in any component for auth state
 * - NO callback route needed - SDK handles OAuth internally
 * - Environment vars: VITE_WORKOS_CLIENT_ID (Vite) or REACT_APP_WORKOS_CLIENT_ID (CRA)
 */
export class ReactGrader implements Grader {
  private fileGrader: FileGrader;
  private buildGrader: BuildGrader;

  constructor(private workDir: string) {
    this.fileGrader = new FileGrader(workDir);
    this.buildGrader = new BuildGrader(workDir);
  }

  async grade(): Promise<GradeResult> {
    const checks: GradeCheck[] = [];

    // AuthKitProvider may live in the entry file or an app-owned provider module, but it must be mounted
    const provider = await findMountedAuthKitProvider(this.workDir);
    checks.push({
      name: 'AuthKitProvider configured with correct SDK',
      passed: provider !== null,
      message: provider
        ? `Found in: ${provider}`
        : 'No mounted AuthKitProvider from @workos-inc/authkit-react (entry file or a module imported elsewhere in src/)',
    });

    // Check useAuth hook usage somewhere in the app
    // Can be in App.tsx, pages/, components/, or anywhere
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        'src/**/*.tsx',
        ['useAuth', '@workos-inc/authkit-react'],
        'useAuth hook usage',
      ),
    );

    // Client ID comes from build-time env (Vite or CRA), read anywhere under src/
    checks.push(
      await this.fileGrader.checkFileWithPattern(
        'src/**/*.{ts,tsx,js,jsx}',
        [/(VITE|REACT_APP)_WORKOS_CLIENT_ID/],
        'Environment variable configuration',
      ),
    );

    // Check build succeeds
    checks.push(await this.buildGrader.checkBuild());

    return {
      passed: checks.every((c) => c.passed),
      checks,
    };
  }
}

const SOURCE_EXT = /\.(tsx|ts|jsx|js)$/;
const IMPORT_SPEC = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;

/**
 * Returns the src-relative file that defines AuthKitProvider when it is mounted:
 * either it is the entry file, or another src file imports its module.
 */
export async function findMountedAuthKitProvider(workDir: string): Promise<string | null> {
  const files = await fg('src/**/*.{tsx,ts,jsx,js}', { cwd: workDir });
  const contents = new Map<string, string>();
  for (const file of files) contents.set(file, await readFile(join(workDir, file), 'utf-8'));

  const providers = files.filter((f) => {
    const c = contents.get(f)!;
    return c.includes('AuthKitProvider') && c.includes('@workos-inc/authkit-react');
  });

  for (const provider of providers) {
    if (/^src\/(main|index)\.(tsx|jsx)$/.test(provider)) return provider;
    const target = provider.replace(SOURCE_EXT, '').replace(/\/index$/, '');
    for (const [importer, content] of contents) {
      if (importer === provider) continue;
      for (const [, spec] of content.matchAll(IMPORT_SPEC)) {
        let resolved: string | null = null;
        if (spec.startsWith('.')) resolved = relative(workDir, resolve(workDir, dirname(importer), spec));
        else if (spec.startsWith('@/')) resolved = join('src', spec.slice(2));
        else if (spec.startsWith('src/')) resolved = spec;
        if (resolved && resolved.replace(SOURCE_EXT, '').replace(/\/index$/, '') === target) return provider;
      }
    }
  }
  return null;
}

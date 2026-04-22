import fg from 'fast-glob';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';

const INVOCATION_PATTERN = /\bgetSignInUrl\s*\(/;

function stripComments(content: string): string {
  return content.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
}

/**
 * True when `directive` ('use client' / 'use server') is the first statement
 * in the file, ignoring leading whitespace and comments. Does NOT match
 * inline 'use server' inside function bodies.
 */
export function hasTopLevelDirective(content: string, directive: string): boolean {
  const stripped = content.replace(/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/g, '');
  return stripped.startsWith(`'${directive}'`) || stripped.startsWith(`"${directive}"`);
}

/**
 * Finds .tsx/.jsx files that call getSignInUrl() without a top-level
 * 'use client' or 'use server' directive. These calls throw in Next.js 15+
 * because the helper sets PKCE cookies via cookies() — only allowed in
 * Server Actions or Route Handlers, not Server Component render.
 *
 * TODO: this can emit a false positive when getSignInUrl() is called
 * exclusively inside a nested function whose body begins with an inline
 * 'use server' directive (an inline Server Action). Regex-based scope
 * analysis can't reliably distinguish render-time calls from inline Server
 * Action calls — an AST-based rewrite would fix it.
 */
export async function findUnsafeGetSignInUrlUsage(workDir: string): Promise<string[]> {
  const files = await fg('**/*.{tsx,jsx}', {
    cwd: workDir,
    ignore: [
      // Build outputs / tooling state
      '**/node_modules/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/.vercel/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/coverage/**',
      // Routes with their own directive contract (callbacks are Route Handlers)
      '**/callback/**',
      // Non-runtime source: stories, tests, fixtures, examples, mocks, docs
      '**/*.stories.{tsx,jsx}',
      '**/*.{test,spec}.{tsx,jsx}',
      '**/__tests__/**',
      '**/__stories__/**',
      '**/__mocks__/**',
      '**/__fixtures__/**',
      '**/tests/**',
      '**/test/**',
      '**/fixtures/**',
      '**/stories/**',
      '**/examples/**',
      '**/docs/**',
      '**/storybook-static/**',
    ],
    absolute: true,
  });

  const results = await Promise.all(
    files.map(async (file) => {
      const content = await readFile(file, 'utf-8');
      const code = stripComments(content);
      const unsafe =
        INVOCATION_PATTERN.test(code) &&
        !hasTopLevelDirective(content, 'use client') &&
        !hasTopLevelDirective(content, 'use server');
      return unsafe ? relative(workDir, file) : null;
    }),
  );

  return results.filter((f): f is string => f !== null);
}

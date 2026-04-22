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
 * Finds .tsx files under app/ or src/app/ that call getSignInUrl() without a
 * top-level 'use client' or 'use server' directive. These calls throw in
 * Next.js 15+ because the helper sets PKCE cookies via cookies() — which is
 * only allowed in Server Actions or Route Handlers, not Server Component render.
 */
export async function findUnsafeGetSignInUrlUsage(workDir: string): Promise<string[]> {
  const files = await fg('{app,src/app}/**/*.tsx', {
    cwd: workDir,
    ignore: ['**/callback/**', '**/node_modules/**'],
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

import fg from 'fast-glob';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import type { QuickCheckResult } from './types.js';

const INVOCATION_PATTERN = /\bgetSignInUrl\s*\(/;

function stripComments(content: string): string {
  return content.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
}

function hasTopLevelDirective(content: string, directive: string): boolean {
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

  const offending: string[] = [];
  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const code = stripComments(content);

    if (
      INVOCATION_PATTERN.test(code) &&
      !hasTopLevelDirective(content, 'use client') &&
      !hasTopLevelDirective(content, 'use server')
    ) {
      offending.push(relative(workDir, file));
    }
  }

  return offending;
}

export async function runServerComponentAudit(projectDir: string): Promise<QuickCheckResult> {
  const startTime = Date.now();
  const offending = await findUnsafeGetSignInUrlUsage(projectDir);

  if (offending.length === 0) {
    return {
      passed: true,
      phase: 'server-component-audit',
      issues: [],
      agentPrompt: null,
      durationMs: Date.now() - startTime,
    };
  }

  const fileList = offending.map((f) => `- ${f}`).join('\n');
  return {
    passed: false,
    phase: 'server-component-audit',
    issues: offending.map((file) => ({
      type: 'file',
      severity: 'error',
      message: `${file} calls getSignInUrl() in a Server Component`,
      hint: 'Move the call into a Client Component with useAuth/refreshAuth, or into a Server Action / Route Handler with a top-level "use server" directive',
    })),
    agentPrompt: `The following files call getSignInUrl() during Server Component render, which throws at runtime in Next.js 15+ because the helper sets PKCE cookies and cookies() is not allowed in render:

${fileList}

Fix one of these ways:
1. Move the sign-in link into a Client Component (new file with 'use client' at the top) using useAuth() from '@workos-inc/authkit-nextjs/components' and refreshAuth({ ensureSignedIn: true }) for the sign-in action.
2. Move the getSignInUrl() call into a Route Handler (e.g. app/sign-in/route.ts) that redirects, and have the Server Component render a plain <a href="/sign-in"> link to that route.

Do NOT add a top-level 'use client' directive to page.tsx or layout.tsx — those should remain Server Components. Fix the caller, not the file.`,
    durationMs: Date.now() - startTime,
  };
}

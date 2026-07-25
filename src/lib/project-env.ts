/**
 * Reader for the project's WorkOS env files.
 *
 * Two halves that must not be confused:
 * - `resolveProjectEnvPath` is the WRITE target — the single file
 *   `writeCredentialsEnv` would create, so the write and the warning copy can
 *   never disagree.
 * - `readProjectEnvCredentials` is the READ side — every file that counts as an
 *   existing WorkOS configuration, because provisioning must refuse whenever the
 *   project already has a key, wherever it happens to live.
 *
 * Kept separate from `run-with-core.ts` so the credential path does not pull
 * xstate and the whole installer graph in behind it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Env files that count as an existing WorkOS configuration, in the precedence
 * order frameworks load them (earlier wins).
 *
 * KEEP IN SYNC: `ENV_FILE_NAMES` in ./credential-discovery.ts, which already
 * treats all four as WorkOS credential sources. A file that discovery reads a
 * key out of must also block provisioning: `.env.local` outranks `.env` in
 * Next.js / Vite / Remix / SvelteKit, so provisioning into `.env.local` over a
 * project configured through `.env` silently points the app at an empty
 * throwaway environment while the real key sits on disk looking correct.
 */
export const ENV_FILE_NAMES = ['.env.local', '.env.development.local', '.env.development', '.env'] as const;

// Leading indentation and an `export ` prefix are both common in env files that
// people also `source`, so both are tolerated. A `#`-commented line can never
// match: only spaces and tabs are allowed before the name.
const WORKOS_API_KEY_PATTERN = /^[ \t]*(?:export[ \t]+)?WORKOS_API_KEY[ \t]*=[ \t]*["']?([^"'\s#]+)["']?/m;
const WORKOS_CLIENT_ID_PATTERN = /^[ \t]*(?:export[ \t]+)?WORKOS_CLIENT_ID[ \t]*=[ \t]*["']?([^"'\s#]+)["']?/m;

export interface ProjectEnvCredentials {
  apiKey?: string;
  clientId?: string;
  /** Absolute path of the file `apiKey` was read from, when one was found. */
  apiKeyPath?: string;
}

/**
 * The env file the CLI would write for this project.
 *
 * Mirrors `writeCredentialsEnv` (`lib/env-writer.ts`): `.env.local` for JS
 * projects (package.json present), `.env` for everything else. If that rule
 * changes, both sides must change together.
 *
 * This is the write target only — it is NOT the set of files that count as
 * already-configured. Use `readProjectEnvCredentials` for that.
 */
export function resolveProjectEnvPath(installDir: string): string {
  return existsSync(join(installDir, 'package.json')) ? join(installDir, '.env.local') : join(installDir, '.env');
}

/**
 * WorkOS credentials already present in any of the project's env files.
 *
 * Scans `ENV_FILE_NAMES` in precedence order and takes the first value found
 * for each key — the same per-key, first-file-wins merge the frameworks
 * themselves perform, so what we read is what the app would see.
 *
 * Read failures are skipped per file — a malformed or unreadable env file should
 * not crash the installer, it should just look unconfigured.
 */
export function readProjectEnvCredentials(installDir: string): ProjectEnvCredentials {
  const found: ProjectEnvCredentials = {};

  for (const fileName of ENV_FILE_NAMES) {
    const envPath = join(installDir, fileName);
    if (!existsSync(envPath)) continue;

    let content: string;
    try {
      content = readFileSync(envPath, 'utf-8');
    } catch {
      continue;
    }

    if (!found.apiKey) {
      const apiKey = content.match(WORKOS_API_KEY_PATTERN)?.[1];
      if (apiKey) {
        found.apiKey = apiKey;
        found.apiKeyPath = envPath;
      }
    }
    found.clientId ??= content.match(WORKOS_CLIENT_ID_PATTERN)?.[1];

    if (found.apiKey && found.clientId) break;
  }

  return found;
}

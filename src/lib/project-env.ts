/**
 * Reader for the project's WorkOS env file.
 *
 * One reader that resolves the same file `writeCredentialsEnv` would write, so
 * the "is this project already configured?" check and the write can never
 * disagree. Kept separate from `run-with-core.ts` so the credential path does
 * not pull xstate and the whole installer graph in behind it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnvFile } from '../utils/env-parser.js';

/**
 * The env file the CLI would write for this project.
 *
 * Mirrors `writeCredentialsEnv` (`lib/env-writer.ts`): `.env.local` for JS
 * projects (package.json present), `.env` for everything else. If that rule
 * changes, both sides must change together.
 */
export function resolveProjectEnvPath(installDir: string): string {
  return existsSync(join(installDir, 'package.json')) ? join(installDir, '.env.local') : join(installDir, '.env');
}

/**
 * WorkOS credentials already present in the project's env file.
 *
 * Read failures resolve to `{}` — a malformed env file should not crash the
 * installer, it should just look unconfigured.
 */
export function readProjectEnvCredentials(installDir: string): { apiKey?: string; clientId?: string } {
  const envPath = resolveProjectEnvPath(installDir);
  if (!existsSync(envPath)) {
    return {};
  }

  try {
    const envVars = parseEnvFile(readFileSync(envPath, 'utf-8'));
    return {
      apiKey: envVars.WORKOS_API_KEY || undefined,
      clientId: envVars.WORKOS_CLIENT_ID || undefined,
    };
  } catch {
    return {};
  }
}

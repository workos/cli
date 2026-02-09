import { execFileNoThrow } from '../../src/utils/exec-file.js';
import { getConfig, getVersion } from '../../src/lib/settings.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Mapping of framework names to their primary skill/agent files.
 * Used to compute git hashes for version tracking.
 */
const SKILL_FILES: Record<string, string> = {
  // Existing JS SDKs (updated paths from Phase 1 migration)
  nextjs: 'src/integrations/nextjs/index.ts',
  react: 'src/integrations/react/index.ts',
  'react-router': 'src/integrations/react-router/index.ts',
  'tanstack-start': 'src/integrations/tanstack-start/index.ts',
  'vanilla-js': 'src/integrations/vanilla-js/index.ts',
  // New SDKs
  sveltekit: 'src/integrations/sveltekit/index.ts',
  node: 'src/integrations/node/index.ts',
  python: 'src/integrations/python/index.ts',
  ruby: 'src/integrations/ruby/index.ts',
  go: 'src/integrations/go/index.ts',
  php: 'src/integrations/php/index.ts',
  'php-laravel': 'src/integrations/php-laravel/index.ts',
  kotlin: 'src/integrations/kotlin/index.ts',
  dotnet: 'src/integrations/dotnet/index.ts',
  elixir: 'src/integrations/elixir/index.ts',
};

export interface VersionMetadata {
  skillVersions: Record<string, string>;
  cliVersion: string;
  modelVersion: string;
}

/**
 * Capture version metadata at eval start.
 * Includes git hashes of skill files and CLI/model versions.
 */
export async function captureVersionMetadata(): Promise<VersionMetadata> {
  const skillVersions: Record<string, string> = {};

  for (const [framework, filePath] of Object.entries(SKILL_FILES)) {
    const hash = await getFileHash(filePath);
    skillVersions[framework] = hash;
  }

  return {
    skillVersions,
    cliVersion: getVersion(),
    modelVersion: getConfig().model,
  };
}

/**
 * Get short git hash of a file using git hash-object.
 * Returns 'unknown' if git is unavailable or file doesn't exist.
 */
async function getFileHash(filePath: string): Promise<string> {
  const result = await execFileNoThrow('git', ['hash-object', filePath], {
    cwd: process.cwd(),
    timeout: 5000,
  });

  if (result.status === 0) {
    return result.stdout.trim().slice(0, 8); // Short hash
  }
  return 'unknown';
}

export { getFileHash };

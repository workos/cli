import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

/**
 * Resolve the package root by walking up from a compiled file until we find package.json.
 * Immune to changes in tsconfig outDir/rootDir structure.
 */
export function getPackageRoot(metaUrl: string): string {
  let dir = dirname(fileURLToPath(metaUrl));
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    dir = dirname(dir);
  }
  throw new Error('Could not find package root (no package.json found in parent directories)');
}

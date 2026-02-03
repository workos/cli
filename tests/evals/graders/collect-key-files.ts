import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import fg from 'fast-glob';
import { QUALITY_KEY_FILES } from '../quality-key-files.js';

/**
 * Collects the content of key integration files for quality grading.
 *
 * Uses glob patterns to find files, reads their content, and returns
 * a map of relative paths to file contents.
 *
 * @param workDir - The working directory to search in
 * @param framework - The framework name (e.g., 'nextjs', 'react')
 * @returns Map of relative file paths to their contents
 */
export async function collectKeyFiles(
  workDir: string,
  framework: string,
): Promise<Map<string, string>> {
  const patterns = QUALITY_KEY_FILES[framework];
  if (!patterns) {
    return new Map();
  }

  const files = new Map<string, string>();
  const foundPaths = new Set<string>();

  for (const pattern of patterns) {
    // Find files matching the pattern
    const matches = await fg(pattern, {
      cwd: workDir,
      absolute: true,
      onlyFiles: true,
      ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**'],
    });

    for (const absPath of matches) {
      const relPath = relative(workDir, absPath);

      // Skip if we already have this file
      if (foundPaths.has(relPath)) {
        continue;
      }

      try {
        const content = await readFile(absPath, 'utf-8');
        files.set(relPath, content);
        foundPaths.add(relPath);
      } catch {
        // Skip unreadable files
      }
    }
  }

  return files;
}

/**
 * Formats key files for inclusion in the quality grading prompt.
 *
 * @param keyFiles - Map of file paths to contents
 * @returns Formatted string with all files as markdown code blocks
 */
export function formatKeyFilesForPrompt(keyFiles: Map<string, string>): string {
  if (keyFiles.size === 0) {
    return 'No key integration files found.';
  }

  return Array.from(keyFiles.entries())
    .map(([path, content]) => {
      const ext = path.split('.').pop() || 'txt';
      return `### ${path}\n\`\`\`${ext}\n${content}\n\`\`\``;
    })
    .join('\n\n');
}

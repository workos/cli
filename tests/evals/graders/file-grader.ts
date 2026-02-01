import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GradeCheck } from '../types.js';

export class FileGrader {
  constructor(protected workDir: string) {}

  async checkFileExists(relativePath: string): Promise<GradeCheck> {
    const fullPath = join(this.workDir, relativePath);
    try {
      await access(fullPath);
      return {
        name: `File exists: ${relativePath}`,
        passed: true,
      };
    } catch {
      return {
        name: `File exists: ${relativePath}`,
        passed: false,
        message: `File not found: ${relativePath}`,
      };
    }
  }

  async checkFileContains(relativePath: string, patterns: (string | RegExp)[]): Promise<GradeCheck[]> {
    const fullPath = join(this.workDir, relativePath);
    const checks: GradeCheck[] = [];

    let content: string;
    try {
      content = await readFile(fullPath, 'utf-8');
    } catch {
      return patterns.map((p) => ({
        name: `Pattern in ${relativePath}: ${p}`,
        passed: false,
        message: `Cannot read file: ${relativePath}`,
      }));
    }

    for (const pattern of patterns) {
      const matches = typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content);

      checks.push({
        name: `Pattern in ${relativePath}: ${pattern}`,
        passed: matches,
        message: matches ? undefined : `Pattern not found: ${pattern}`,
      });
    }

    return checks;
  }
}

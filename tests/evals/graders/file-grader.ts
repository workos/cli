import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { glob } from 'fast-glob';
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

  async checkFileExistsOneOf(relativePaths: string[]): Promise<GradeCheck> {
    for (const relativePath of relativePaths) {
      const fullPath = join(this.workDir, relativePath);
      try {
        await access(fullPath);
        return {
          name: `File exists: ${relativePaths.join(' OR ')}`,
          passed: true,
          message: `Found: ${relativePath}`,
        };
      } catch {
        // Continue checking
      }
    }
    return {
      name: `File exists: ${relativePaths.join(' OR ')}`,
      passed: false,
      message: `None found: ${relativePaths.join(', ')}`,
    };
  }

  async checkFileWithPattern(
    globPattern: string,
    contentPatterns: (string | RegExp)[],
    description: string,
  ): Promise<GradeCheck> {
    const files = await glob(globPattern, { cwd: this.workDir, absolute: true });

    for (const file of files) {
      try {
        const content = await readFile(file, 'utf-8');
        const allMatch = contentPatterns.every((p) =>
          typeof p === 'string' ? content.includes(p) : p.test(content),
        );
        if (allMatch) {
          const relativePath = file.replace(this.workDir + '/', '');
          return {
            name: description,
            passed: true,
            message: `Found in: ${relativePath}`,
          };
        }
      } catch {
        // Continue checking other files
      }
    }

    return {
      name: description,
      passed: false,
      message: `No file matching ${globPattern} contains required patterns`,
    };
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

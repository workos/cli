import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Supported programming languages for framework detection.
 */
export type Language = 'javascript' | 'python' | 'ruby' | 'php' | 'go' | 'kotlin' | 'dotnet' | 'elixir';

export interface LanguageSignal {
  language: Language;
  confidence: number; // 0-1
  manifestFile: string;
}

export interface LanguageDetectionResult {
  primary: Language;
  signals: LanguageSignal[];
  ambiguous: boolean;
}

function fileExists(cwd: string, filename: string): { found: boolean; manifestFile: string } {
  const fullPath = join(cwd, filename);
  return { found: existsSync(fullPath), manifestFile: filename };
}

function globExists(cwd: string, pattern: string): { found: boolean; manifestFile: string } {
  // Simple glob for *.ext patterns in the root directory
  const ext = pattern.replace('*', '');
  try {
    const files = readdirSync(cwd);
    const match = files.find((f) => f.endsWith(ext));
    return { found: !!match, manifestFile: match || pattern };
  } catch {
    return { found: false, manifestFile: pattern };
  }
}

function detectPython(cwd: string): { found: boolean; manifestFile: string } {
  for (const file of ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile']) {
    if (existsSync(join(cwd, file))) {
      return { found: true, manifestFile: file };
    }
  }
  return { found: false, manifestFile: 'pyproject.toml' };
}

function detectKotlin(cwd: string): { found: boolean; manifestFile: string } {
  const ktsPath = join(cwd, 'build.gradle.kts');
  if (existsSync(ktsPath)) {
    try {
      const content = readFileSync(ktsPath, 'utf-8');
      if (/org\.jetbrains\.kotlin/.test(content) || /kotlin\(/.test(content)) {
        return { found: true, manifestFile: 'build.gradle.kts' };
      }
    } catch {
      // Can't read file
    }
  }

  // Also check build.gradle (Groovy DSL)
  const gradlePath = join(cwd, 'build.gradle');
  if (existsSync(gradlePath)) {
    try {
      const content = readFileSync(gradlePath, 'utf-8');
      if (/kotlin/.test(content)) {
        return { found: true, manifestFile: 'build.gradle' };
      }
    } catch {
      // Can't read file
    }
  }

  return { found: false, manifestFile: 'build.gradle.kts' };
}

/**
 * Language detectors ordered by specificity.
 * More specific languages are checked first.
 * JavaScript is last because many non-JS projects also have package.json.
 */
const LANGUAGE_DETECTORS: Array<{
  language: Language;
  detect: (cwd: string) => { found: boolean; manifestFile: string };
}> = [
  { language: 'elixir', detect: (cwd) => fileExists(cwd, 'mix.exs') },
  { language: 'go', detect: (cwd) => fileExists(cwd, 'go.mod') },
  { language: 'dotnet', detect: (cwd) => globExists(cwd, '*.csproj') },
  { language: 'kotlin', detect: detectKotlin },
  { language: 'ruby', detect: (cwd) => fileExists(cwd, 'Gemfile') },
  { language: 'php', detect: (cwd) => fileExists(cwd, 'composer.json') },
  { language: 'python', detect: detectPython },
  { language: 'javascript', detect: (cwd) => fileExists(cwd, 'package.json') },
];

/**
 * Detect the primary programming language of a project.
 * Runs all detectors and returns the highest-priority match.
 * Sets `ambiguous: true` if multiple non-JS languages are detected.
 */
export function detectLanguage(cwd: string): LanguageDetectionResult | undefined {
  const signals: LanguageSignal[] = [];

  for (const detector of LANGUAGE_DETECTORS) {
    const result = detector.detect(cwd);
    if (result.found) {
      signals.push({
        language: detector.language,
        confidence: 1.0,
        manifestFile: result.manifestFile,
      });
    }
  }

  if (signals.length === 0) {
    return undefined;
  }

  const primary = signals[0].language;

  // Ambiguous if multiple non-JS languages detected
  const nonJsSignals = signals.filter((s) => s.language !== 'javascript');
  const ambiguous = nonJsSignals.length > 1;

  return { primary, signals, ambiguous };
}

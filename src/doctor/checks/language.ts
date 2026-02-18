import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LanguageInfo } from '../types.js';

interface LanguageDetector {
  name: string;
  language: string; // matches SdkInfo.language
  manifestFiles: string[];
  /** Globs that need special handling (e.g., *.csproj) */
  globPatterns?: string[];
  packageManager?: string;
}

const DETECTORS: LanguageDetector[] = [
  { name: 'Go', language: 'go', manifestFiles: ['go.mod'], packageManager: 'go modules' },
  { name: 'Ruby', language: 'ruby', manifestFiles: ['Gemfile'], packageManager: 'bundler' },
  {
    name: 'Python',
    language: 'python',
    manifestFiles: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'],
    packageManager: 'pip',
  },
  {
    name: 'Java',
    language: 'java',
    manifestFiles: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    packageManager: 'maven',
  },
  { name: 'PHP', language: 'php', manifestFiles: ['composer.json'], packageManager: 'composer' },
  { name: 'C#/.NET', language: 'dotnet', manifestFiles: [], globPatterns: ['*.csproj', '*.sln'] },
  // JS/TS last — most projects have a package.json even if they're primarily another language
  { name: 'JavaScript/TypeScript', language: 'javascript', manifestFiles: ['package.json'] },
];

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findGlobMatch(dir: string, patterns: string[]): Promise<string | undefined> {
  // Simple glob for *.ext patterns — check common filenames
  const { readdir } = await import('node:fs/promises');
  try {
    const entries = await readdir(dir);
    for (const pattern of patterns) {
      const ext = pattern.replace('*', '');
      const match = entries.find((e) => e.endsWith(ext));
      if (match) return match;
    }
  } catch {
    // directory not readable
  }
  return undefined;
}

function detectPythonPackageManager(manifestFile: string): string {
  if (manifestFile === 'pyproject.toml') return 'poetry';
  if (manifestFile === 'Pipfile') return 'pipenv';
  return 'pip';
}

export async function checkLanguage(installDir: string): Promise<LanguageInfo> {
  for (const detector of DETECTORS) {
    // Check manifest files
    for (const manifest of detector.manifestFiles) {
      const path = join(installDir, manifest);
      if (await fileExists(path)) {
        const pm =
          detector.language === 'python'
            ? detectPythonPackageManager(manifest)
            : detector.packageManager;

        return {
          name: detector.name,
          manifestFile: manifest,
          packageManager: pm,
        };
      }
    }

    // Check glob patterns (e.g., *.csproj)
    if (detector.globPatterns) {
      const match = await findGlobMatch(installDir, detector.globPatterns);
      if (match) {
        return {
          name: detector.name,
          manifestFile: match,
          packageManager: detector.packageManager,
        };
      }
    }
  }

  return { name: 'Unknown' };
}

/** Map a LanguageInfo name to the SdkInfo.language string */
export function languageToSdkLanguage(languageName: string): string {
  const detector = DETECTORS.find((d) => d.name === languageName);
  return detector?.language ?? 'unknown';
}

/** Get the SDK install command for a language */
export function getInstallHint(language: string): string {
  switch (language) {
    case 'python':
      return 'pip install workos';
    case 'ruby':
      return "gem install workos (or add gem 'workos' to Gemfile)";
    case 'go':
      return 'go get github.com/workos/workos-go/v4';
    case 'java':
      return 'Add com.workos:workos-java to your pom.xml or build.gradle';
    case 'php':
      return 'composer require workos/workos-php';
    case 'dotnet':
      return 'dotnet add package WorkOS.net';
    default:
      return 'npm install @workos-inc/authkit-nextjs';
  }
}

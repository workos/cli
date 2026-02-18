import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasPackageInstalled, getPackageVersion } from '../../utils/package-json.js';
import { detectPort, getCallbackPath } from '../../lib/port-detection.js';
import { KNOWN_INTEGRATIONS } from '../../lib/constants.js';
import type { Integration } from '../../lib/constants.js';
import type { DoctorOptions, FrameworkInfo } from '../types.js';

function readPackageJson(installDir: string): Record<string, unknown> | null {
  try {
    const content = readFileSync(join(installDir, 'package.json'), 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface FrameworkConfig {
  package: string;
  name: string;
  integration: Integration | null; // Maps to Integration type for callback path/port
  detectVariant: ((options: DoctorOptions) => Promise<string | undefined>) | null;
}

// Order matters - more specific frameworks should come first (array guarantees order)
const FRAMEWORKS: FrameworkConfig[] = [
  { package: 'next', name: 'Next.js', integration: KNOWN_INTEGRATIONS.nextjs, detectVariant: detectNextVariant },
  {
    package: '@tanstack/react-start',
    name: 'TanStack Start',
    integration: KNOWN_INTEGRATIONS.tanstackStart,
    detectVariant: null,
  },
  {
    package: '@tanstack/start',
    name: 'TanStack Start',
    integration: KNOWN_INTEGRATIONS.tanstackStart,
    detectVariant: null,
  },
  { package: '@tanstack/react-router', name: 'TanStack Router', integration: null, detectVariant: null },
  { package: '@remix-run/node', name: 'Remix', integration: null, detectVariant: null },
  {
    package: 'react-router-dom',
    name: 'React Router',
    integration: KNOWN_INTEGRATIONS.reactRouter,
    detectVariant: null,
  },
  { package: 'express', name: 'Express', integration: null, detectVariant: null },
  // Additional JS frameworks (after existing entries to avoid breaking current behavior)
  { package: 'expo', name: 'Expo', integration: null, detectVariant: detectExpoVariant },
  { package: 'react-native', name: 'React Native', integration: null, detectVariant: null },
  { package: '@sveltejs/kit', name: 'SvelteKit', integration: null, detectVariant: null },
  { package: 'nuxt', name: 'Nuxt', integration: null, detectVariant: detectNuxtVariant },
  { package: 'vue', name: 'Vue.js', integration: null, detectVariant: null },
  { package: 'astro', name: 'Astro', integration: null, detectVariant: null },
  { package: 'svelte', name: 'Svelte', integration: null, detectVariant: null },
];

export async function checkFramework(options: DoctorOptions): Promise<FrameworkInfo> {
  const packageJson = readPackageJson(options.installDir);
  if (!packageJson) return { name: null, version: null };

  for (const config of FRAMEWORKS) {
    if (hasPackageInstalled(config.package, packageJson)) {
      const version = getPackageVersion(config.package, packageJson) ?? null;
      const variant = config.detectVariant ? await config.detectVariant(options) : undefined;

      // Get expected callback path and port if we have an integration mapping
      let expectedCallbackPath: string | undefined;
      let detectedPort: number | undefined;

      if (config.integration) {
        expectedCallbackPath = getCallbackPath(config.integration);
        detectedPort = detectPort(config.integration, options.installDir);
      }

      return {
        name: config.name,
        version,
        variant,
        expectedCallbackPath,
        detectedPort,
      };
    }
  }

  return { name: null, version: null };
}

async function detectExpoVariant(options: DoctorOptions): Promise<string> {
  const iosDir = join(options.installDir, 'ios');
  const androidDir = join(options.installDir, 'android');
  const hasBare = existsSync(iosDir) || existsSync(androidDir);
  return hasBare ? 'bare' : 'managed';
}

async function detectNuxtVariant(options: DoctorOptions): Promise<string | undefined> {
  const packageJson = readPackageJson(options.installDir);
  if (!packageJson) return undefined;
  const version = getPackageVersion('nuxt', packageJson);
  if (!version) return undefined;
  const major = parseInt(version.replace(/^[\^~>=<]+/, '').split('.')[0], 10);
  return isNaN(major) ? undefined : major >= 3 ? 'Nuxt 3' : 'Nuxt 2';
}

async function detectNextVariant(options: DoctorOptions): Promise<string> {
  const appDir = join(options.installDir, 'app');
  const pagesDir = join(options.installDir, 'pages');
  const srcAppDir = join(options.installDir, 'src', 'app');
  const srcPagesDir = join(options.installDir, 'src', 'pages');

  const hasAppDir = existsSync(appDir) || existsSync(srcAppDir);
  const hasPagesDir = existsSync(pagesDir) || existsSync(srcPagesDir);

  if (hasAppDir && hasPagesDir) return 'hybrid';
  if (hasAppDir) return 'app-router';
  return 'pages-router';
}

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getPackageDotJson } from '../../utils/clack-utils.js';
import { hasPackageInstalled, getPackageVersion } from '../../utils/package-json.js';
import { detectPort, getCallbackPath } from '../../lib/port-detection.js';
import { KNOWN_INTEGRATIONS } from '../../lib/constants.js';
import type { Integration } from '../../lib/constants.js';
import type { DoctorOptions, FrameworkInfo } from '../types.js';

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
];

export async function checkFramework(options: DoctorOptions): Promise<FrameworkInfo> {
  let packageJson;
  try {
    packageJson = await getPackageDotJson(options);
  } catch {
    return { name: null, version: null };
  }

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

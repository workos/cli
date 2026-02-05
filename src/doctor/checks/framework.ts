import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getPackageDotJson } from '../../utils/clack-utils.js';
import { hasPackageInstalled, getPackageVersion } from '../../utils/package-json.js';
import type { DoctorOptions, FrameworkInfo } from '../types.js';

interface FrameworkConfig {
  name: string;
  detectVariant: ((options: DoctorOptions) => Promise<string | undefined>) | null;
}

const FRAMEWORKS: Record<string, FrameworkConfig> = {
  next: { name: 'Next.js', detectVariant: detectNextVariant },
  express: { name: 'Express', detectVariant: null },
  '@remix-run/node': { name: 'Remix', detectVariant: null },
  '@tanstack/react-router': { name: 'TanStack Router', detectVariant: null },
  '@tanstack/start': { name: 'TanStack Start', detectVariant: null },
  'react-router-dom': { name: 'React Router', detectVariant: null },
};

export async function checkFramework(options: DoctorOptions): Promise<FrameworkInfo> {
  let packageJson;
  try {
    packageJson = await getPackageDotJson(options);
  } catch {
    return { name: null, version: null };
  }

  for (const [pkg, config] of Object.entries(FRAMEWORKS)) {
    if (hasPackageInstalled(pkg, packageJson)) {
      const version = getPackageVersion(pkg, packageJson) ?? null;
      const variant = config.detectVariant ? await config.detectVariant(options) : undefined;

      return {
        name: config.name,
        version,
        variant,
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

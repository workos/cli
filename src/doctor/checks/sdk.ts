import { getPackageDotJson } from '../../utils/clack-utils.js';
import { hasPackageInstalled, getPackageVersion } from '../../utils/package-json.js';
import type { DoctorOptions, SdkInfo } from '../types.js';

// AuthKit SDKs - check newer @workos/* scope first, then legacy @workos-inc/*
const SDK_PACKAGES = [
  // New @workos/* scope
  '@workos/authkit-nextjs',
  '@workos/authkit-tanstack-react-start',
  '@workos/authkit-react-router',
  '@workos/authkit-remix',
  '@workos/authkit-sveltekit',
  '@workos/authkit-react',
  '@workos/authkit-js',
  // Legacy @workos-inc/* scope
  '@workos-inc/authkit-nextjs',
  '@workos-inc/authkit-remix',
  '@workos-inc/authkit-react-router',
  '@workos-inc/authkit-react',
  '@workos-inc/authkit-js',
  '@workos-inc/node',
  'workos', // very old legacy
] as const;

const AUTHKIT_PACKAGES = new Set([
  '@workos/authkit-nextjs',
  '@workos/authkit-tanstack-react-start',
  '@workos/authkit-react-router',
  '@workos/authkit-remix',
  '@workos/authkit-sveltekit',
  '@workos/authkit-react',
  '@workos/authkit-js',
  '@workos-inc/authkit-nextjs',
  '@workos-inc/authkit-remix',
  '@workos-inc/authkit-react-router',
  '@workos-inc/authkit-react',
  '@workos-inc/authkit-js',
]);

export async function checkSdk(options: DoctorOptions): Promise<SdkInfo> {
  let packageJson;
  try {
    packageJson = await getPackageDotJson(options);
  } catch {
    return {
      name: null,
      version: null,
      latest: null,
      outdated: false,
      isAuthKit: false,
    };
  }

  // Find installed SDK (order matters—AuthKit before standalone)
  const installedSdk = SDK_PACKAGES.find((pkg) => hasPackageInstalled(pkg, packageJson));

  if (!installedSdk) {
    return {
      name: null,
      version: null,
      latest: null,
      outdated: false,
      isAuthKit: false,
    };
  }

  const version = getPackageVersion(installedSdk, packageJson) ?? null;
  const latest = await fetchLatestVersion(installedSdk);

  return {
    name: installedSdk,
    version,
    latest,
    outdated: version && latest ? isVersionOutdated(version, latest) : false,
    isAuthKit: AUTHKIT_PACKAGES.has(installedSdk),
  };
}

async function fetchLatestVersion(packageName: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;
    const data = (await response.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

function isVersionOutdated(current: string, latest: string): boolean {
  // Strip semver range prefixes (^, ~, etc.)
  const cleanCurrent = current.replace(/^[\^~>=<]+/, '');
  const cleanLatest = latest.replace(/^[\^~>=<]+/, '');

  const [currMajor, currMinor, currPatch] = cleanCurrent.split('.').map(Number);
  const [latMajor, latMinor, latPatch] = cleanLatest.split('.').map(Number);

  if (latMajor > currMajor) return true;
  if (latMajor === currMajor && latMinor > currMinor) return true;
  if (latMajor === currMajor && latMinor === currMinor && latPatch > currPatch) return true;
  return false;
}

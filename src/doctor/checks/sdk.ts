import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
      language: 'javascript',
    };
  }

  // Find installed SDK (order matters—AuthKit before standalone)
  const installedSdk = SDK_PACKAGES.find((pkg) => hasPackageInstalled(pkg, packageJson));

  if (!installedSdk) {
    // No JS SDK — try non-JS language manifests
    const nonJs = await checkNonJsSdk(options.installDir);
    if (nonJs) return nonJs;

    return {
      name: null,
      version: null,
      latest: null,
      outdated: false,
      isAuthKit: false,
      language: 'javascript',
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
    language: 'javascript',
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

interface NonJsDetector {
  language: string;
  file: string;
  pattern: RegExp;
  nameExtract?: string; // Static SDK name when pattern matches
  versionGroup?: number; // Capture group index for version
}

const NON_JS_DETECTORS: NonJsDetector[] = [
  {
    language: 'python',
    file: 'requirements.txt',
    pattern: /^workos(?:-python)?(?:==|>=|~=|!=)?([\d.]*)/m,
    nameExtract: 'workos-python',
    versionGroup: 1,
  },
  {
    language: 'python',
    file: 'pyproject.toml',
    pattern: /workos(?:-python)?/m,
    nameExtract: 'workos-python',
  },
  {
    language: 'ruby',
    file: 'Gemfile',
    pattern: /gem\s+['"]workos(?:-ruby)?['"]/m,
    nameExtract: 'workos-ruby',
  },
  {
    language: 'go',
    file: 'go.mod',
    pattern: /github\.com\/workos\/workos-go(?:\/v\d+)?\s+(v[\d.]+)/m,
    nameExtract: 'workos-go',
    versionGroup: 1,
  },
  {
    language: 'java',
    file: 'pom.xml',
    pattern: /<groupId>com\.workos<\/groupId>/m,
    nameExtract: 'workos-java',
  },
  {
    language: 'java',
    file: 'build.gradle',
    pattern: /com\.workos/m,
    nameExtract: 'workos-java',
  },
  {
    language: 'php',
    file: 'composer.json',
    pattern: /"workos\/workos-php"/m,
    nameExtract: 'workos-php',
  },
];

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

async function checkNonJsSdk(installDir: string): Promise<SdkInfo | null> {
  for (const detector of NON_JS_DETECTORS) {
    const content = await readFileSafe(join(installDir, detector.file));
    if (!content) continue;

    const match = content.match(detector.pattern);
    if (match) {
      const version = detector.versionGroup ? match[detector.versionGroup] || null : null;
      return {
        name: detector.nameExtract ?? null,
        version,
        latest: null, // No registry checks for non-JS in this phase
        outdated: false,
        isAuthKit: false,
        language: detector.language,
      };
    }
  }

  // Check .csproj files for .NET (requires directory listing)
  try {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(installDir);
    for (const entry of entries) {
      if (entry.endsWith('.csproj')) {
        const content = await readFileSafe(join(installDir, entry));
        if (content && /PackageReference.*Include="WorkOS\.net"/i.test(content)) {
          const versionMatch = content.match(/Include="WorkOS\.net".*?Version="([\d.]+)"/i);
          return {
            name: 'WorkOS.net',
            version: versionMatch?.[1] ?? null,
            latest: null,
            outdated: false,
            isAuthKit: false,
            language: 'dotnet',
          };
        }
      }
    }
  } catch {
    // directory not readable
  }

  return null;
}

function isVersionOutdated(current: string, latest: string): boolean {
  // Strip semver range prefixes (^, ~, etc.) and workspace protocol
  const cleanCurrent = current.replace(/^[\^~>=<]+/, '').replace(/^workspace:\*?/, '');
  const cleanLatest = latest.replace(/^[\^~>=<]+/, '');

  // Handle prerelease: "1.0.0-beta.1" → "1.0.0", "-beta.1"
  const [currBase] = cleanCurrent.split('-');
  const [latBase] = cleanLatest.split('-');

  const currParts = currBase.split('.').map(Number);
  const latParts = latBase.split('.').map(Number);

  // If we got NaN values, we can't reliably compare - assume not outdated
  if (currParts.some(isNaN) || latParts.some(isNaN)) {
    return false;
  }

  const [currMajor = 0, currMinor = 0, currPatch = 0] = currParts;
  const [latMajor = 0, latMinor = 0, latPatch = 0] = latParts;

  if (latMajor > currMajor) return true;
  if (latMajor === currMajor && latMinor > currMinor) return true;
  if (latMajor === currMajor && latMinor === currMinor && latPatch > currPatch) return true;
  return false;
}

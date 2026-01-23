import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';

import chalk from 'chalk';
import { traceStep } from '../telemetry.js';
import { debug } from './debug.js';
import { parseEnvFile } from './env-parser.js';
import { type PackageDotJson, hasPackageInstalled } from './package-json.js';
import { type PackageManager, detectAllPackageManagers, packageManagers, NPM as npm } from './package-manager.js';
import { fulfillsVersionRange } from './semver.js';
import type { Feature, WizardOptions } from './types.js';
import { getPackageVersion } from './package-json.js';
import { ISSUES_URL, type Integration } from '../lib/constants.js';
import { analytics } from './analytics.js';
import clack from './clack.js';
import { INTEGRATION_CONFIG } from '../lib/config.js';

interface ProjectData {
  projectApiKey: string;
  accessToken: string;
  host: string;
  distinctId: string;
  projectId: number;
}

export interface CliSetupConfig {
  filename: string;
  name: string;
  gitignore: boolean;

  likelyAlreadyHasAuthToken(contents: string): boolean;
  tokenContent(authToken: string): string;

  likelyAlreadyHasOrgAndProject(contents: string): boolean;
  orgAndProjContent(org: string, project: string): string;

  likelyAlreadyHasUrl?(contents: string): boolean;
  urlContent?(url: string): string;
}

export interface CliSetupConfigContent {
  authToken: string;
  org?: string;
  project?: string;
  url?: string;
}

export async function abort(message?: string, status?: number): Promise<never> {
  await analytics.shutdown('cancelled');

  clack.outro(message ?? 'Wizard setup cancelled.');
  return process.exit(status ?? 1);
}

export async function abortIfCancelled<T>(
  input: T | Promise<T>,
  integration?: Integration,
): Promise<Exclude<T, symbol>> {
  await analytics.shutdown('cancelled');
  const resolvedInput = await input;

  if (
    clack.isCancel(resolvedInput) ||
    (typeof resolvedInput === 'symbol' && resolvedInput.description === 'clack:cancel')
  ) {
    const docsUrl = integration ? INTEGRATION_CONFIG[integration].docsUrl : 'https://workos.com/docs/user-management';

    clack.cancel(
      `Wizard setup cancelled. You can read the documentation for ${
        integration ?? 'WorkOS AuthKit'
      } at ${chalk.cyan(docsUrl)} to continue with the setup manually.`,
    );
    process.exit(0);
  } else {
    return input as Exclude<T, symbol>;
  }
}

export function printWelcome(options: { wizardName: string; message?: string }): void {
  // eslint-disable-next-line no-console
  console.log('');
  clack.intro(chalk.inverse(` ${options.wizardName} `));

  const welcomeText =
    options.message ||
    `The ${options.wizardName} will help you set up WorkOS AuthKit for your application.\nThank you for using WorkOS AuthKit :)`;

  clack.note(welcomeText);
}

export async function confirmContinueIfNoOrDirtyGitRepo(options: Pick<WizardOptions, 'ci'>): Promise<void> {
  return traceStep('check-git-status', async () => {
    if (!isInGitRepo()) {
      // CI mode: auto-continue without git
      const continueWithoutGit = options.ci
        ? true
        : await abortIfCancelled(
            clack.confirm({
              message:
                'You are not inside a git repository. The wizard will create and update files. Do you want to continue anyway?',
            }),
          );

      analytics.setTag('continue-without-git', continueWithoutGit);

      if (!continueWithoutGit) {
        await abort(undefined, 0);
      }
      // return early to avoid checking for uncommitted files
      return;
    }

    const uncommittedOrUntrackedFiles = getUncommittedOrUntrackedFiles();
    if (uncommittedOrUntrackedFiles.length) {
      // CI mode: auto-continue with dirty repo
      if (options.ci) {
        clack.log.info(`CI mode: continuing with uncommitted/untracked files in repo`);
        analytics.setTag('continue-with-dirty-repo', true);
        return;
      }

      clack.log.warn(
        `You have uncommitted or untracked files in your repo:

${uncommittedOrUntrackedFiles.join('\n')}

The wizard will create and update files.`,
      );
      const continueWithDirtyRepo = await abortIfCancelled(
        clack.confirm({
          message: 'Do you want to continue anyway?',
        }),
      );

      analytics.setTag('continue-with-dirty-repo', continueWithDirtyRepo);

      if (!continueWithDirtyRepo) {
        await abort(undefined, 0);
      }
    }
  });
}

export function isInGitRepo() {
  try {
    childProcess.execSync('git rev-parse --is-inside-work-tree', {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

export function getUncommittedOrUntrackedFiles(): string[] {
  try {
    const gitStatus = childProcess
      .execSync('git status --porcelain=v1', {
        // we only care about stdout
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      .toString();

    const files = gitStatus
      .split(os.EOL)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((f) => `- ${f.split(/\s+/)[1]}`);

    return files;
  } catch {
    return [];
  }
}

export async function askForItemSelection(items: string[], message: string): Promise<{ value: string; index: number }> {
  const selection = await abortIfCancelled<{ value: string; index: number } | symbol>(
    clack.select({
      maxItems: 12,
      message: message,
      options: items.map((item, index) => {
        return {
          value: { value: item, index: index },
          label: item,
        };
      }),
    }),
  );

  return selection as { value: string; index: number };
}

export async function confirmContinueIfPackageVersionNotSupported({
  packageId,
  packageName,
  packageVersion,
  acceptableVersions,
  note,
}: {
  packageId: string;
  packageName: string;
  packageVersion: string;
  acceptableVersions: string;
  note?: string;
}): Promise<void> {
  return traceStep(`check-package-version`, async () => {
    analytics.setTag(`${packageName.toLowerCase()}-version`, packageVersion);
    const isSupportedVersion = fulfillsVersionRange({
      acceptableVersions,
      version: packageVersion,
      canBeLatest: true,
    });

    if (isSupportedVersion) {
      analytics.setTag(`${packageName.toLowerCase()}-supported`, true);
      return;
    }

    clack.log.warn(
      `You have an unsupported version of ${packageName} installed:

  ${packageId}@${packageVersion}`,
    );

    clack.note(note ?? `Please upgrade to ${acceptableVersions} if you wish to use the WorkOS AuthKit wizard.`);
    const continueWithUnsupportedVersion = await abortIfCancelled(
      clack.confirm({
        message: 'Do you want to continue anyway?',
      }),
    );
    analytics.setTag(`${packageName.toLowerCase()}-continue-with-unsupported-version`, continueWithUnsupportedVersion);

    if (!continueWithUnsupportedVersion) {
      await abort(undefined, 0);
    }
  });
}

export async function isReact19Installed({ installDir }: Pick<WizardOptions, 'installDir'>): Promise<boolean> {
  try {
    const packageJson = await getPackageDotJson({ installDir });
    const reactVersion = getPackageVersion('react', packageJson);

    if (!reactVersion) {
      return false;
    }

    return fulfillsVersionRange({
      version: reactVersion,
      acceptableVersions: '>=19.0.0',
      canBeLatest: true,
    });
  } catch (error) {
    return false;
  }
}

/**
 * Installs or updates a package with the user's package manager.
 *
 * IMPORTANT: This function modifies the `package.json`! Be sure to re-read
 * it if you make additional modifications to it after calling this function!
 */
export async function installPackage({
  packageName,
  alreadyInstalled,
  askBeforeUpdating = true,
  packageNameDisplayLabel,
  packageManager,
  forceInstall = false,
  integration,
  installDir,
}: {
  /** The string that is passed to the package manager CLI as identifier to install (e.g. `@workos-inc/authkit-nextjs`, or `@workos-inc/authkit-nextjs@^2.0.0`) */
  packageName: string;
  alreadyInstalled: boolean;
  askBeforeUpdating?: boolean;
  /** Overrides what is shown in the installation logs in place of the `packageName` option. Useful if the `packageName` is ugly */
  packageNameDisplayLabel?: string;
  packageManager?: PackageManager;
  /** Add force install flag to command to skip install precondition fails */
  forceInstall?: boolean;
  /** The integration that is being used */
  integration?: string;
  /** The directory to install the package in */
  installDir: string;
}): Promise<{ packageManager?: PackageManager }> {
  return traceStep('install-package', async () => {
    if (alreadyInstalled && askBeforeUpdating) {
      const shouldUpdatePackage = await abortIfCancelled(
        clack.confirm({
          message: `The ${chalk.bold.cyan(
            packageNameDisplayLabel ?? packageName,
          )} package is already installed. Do you want to update it to the latest version?`,
        }),
      );

      if (!shouldUpdatePackage) {
        return {};
      }
    }

    const sdkInstallSpinner = clack.spinner();

    const pkgManager = packageManager || (await getPackageManager({ installDir }));

    // Most packages aren't compatible with React 19 yet, skip strict peer dependency checks if needed.
    const isReact19 = await isReact19Installed({ installDir });
    const legacyPeerDepsFlag = isReact19 && pkgManager.name === 'npm' ? '--legacy-peer-deps' : '';

    sdkInstallSpinner.start(
      `${alreadyInstalled ? 'Updating' : 'Installing'} ${chalk.bold.cyan(
        packageNameDisplayLabel ?? packageName,
      )} with ${chalk.bold(pkgManager.label)}.`,
    );

    try {
      await new Promise<void>((resolve, reject) => {
        childProcess.exec(
          `${pkgManager.installCommand} ${packageName} ${pkgManager.flags} ${
            forceInstall ? pkgManager.forceInstallFlag : ''
          } ${legacyPeerDepsFlag}`.trim(),
          { cwd: installDir },
          (err, stdout, stderr) => {
            if (err) {
              // Write a log file so we can better troubleshoot issues
              fs.writeFileSync(
                join(process.cwd(), `authkit-wizard-installation-error-${Date.now()}.log`),
                JSON.stringify({
                  stdout,
                  stderr,
                }),
                { encoding: 'utf8' },
              );

              reject(err);
            } else {
              resolve();
            }
          },
        );
      });
    } catch (e) {
      sdkInstallSpinner.stop('Installation failed.');
      clack.log.error(
        `${chalk.red(
          'Encountered the following error during installation:',
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        )}\n\n${e}\n\n${chalk.dim(
          `The wizard has created an \`authkit-wizard-installation-error-*.log\` file. If you think this issue is caused by the WorkOS AuthKit wizard, create an issue on GitHub and include the log file's content:\n${ISSUES_URL}`,
        )}`,
      );
      await abort();
    }

    sdkInstallSpinner.stop(
      `${alreadyInstalled ? 'Updated' : 'Installed'} ${chalk.bold.cyan(
        packageNameDisplayLabel ?? packageName,
      )} with ${chalk.bold(pkgManager.label)}.`,
    );

    analytics.capture('wizard interaction', {
      action: 'package installed',
      package_name: packageName,
      package_manager: pkgManager.name,
      integration,
    });

    return { packageManager: pkgManager };
  });
}

/**
 * Checks if @param packageId is listed as a dependency in @param packageJson.
 * If not, it will ask users if they want to continue without the package.
 *
 * Use this function to check if e.g. a the framework of the SDK is installed
 *
 * @param packageJson the package.json object
 * @param packageId the npm name of the package
 * @param packageName a human readable name of the package
 */
export async function ensurePackageIsInstalled(
  packageJson: PackageDotJson,
  packageId: string,
  packageName: string,
  options?: Pick<WizardOptions, 'dashboard'>,
): Promise<void> {
  return traceStep('ensure-package-installed', async () => {
    const installed = hasPackageInstalled(packageId, packageJson);

    analytics.setTag(`${packageName.toLowerCase()}-installed`, installed);

    if (!installed) {
      // In dashboard mode, auto-continue (integration was already detected)
      if (options?.dashboard) {
        return;
      }

      const continueWithoutPackage = await abortIfCancelled(
        clack.confirm({
          message: `${packageName} does not seem to be installed. Do you still want to continue?`,
          initialValue: false,
        }),
      );

      if (!continueWithoutPackage) {
        await abort(undefined, 0);
      }
    }
  });
}

export async function getPackageDotJson({ installDir }: Pick<WizardOptions, 'installDir'>): Promise<PackageDotJson> {
  const packageJsonFileContents = await fs.promises.readFile(join(installDir, 'package.json'), 'utf8').catch(() => {
    clack.log.error('Could not find package.json. Make sure to run the wizard in the root of your app!');
    return abort();
  });

  let packageJson: PackageDotJson | undefined = undefined;

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    packageJson = JSON.parse(packageJsonFileContents);
  } catch {
    clack.log.error(`Unable to parse your ${chalk.cyan('package.json')}. Make sure it has a valid format!`);

    await abort();
  }

  return packageJson || {};
}

export async function updatePackageDotJson(
  packageDotJson: PackageDotJson,
  { installDir }: Pick<WizardOptions, 'installDir'>,
): Promise<void> {
  try {
    await fs.promises.writeFile(
      join(installDir, 'package.json'),
      // TODO: maybe figure out the original indentation
      JSON.stringify(packageDotJson, null, 2),
      {
        encoding: 'utf8',
        flag: 'w',
      },
    );
  } catch {
    clack.log.error(`Unable to update your ${chalk.cyan('package.json')}.`);

    await abort();
  }
}

export async function getPackageManager(
  options: Pick<WizardOptions, 'installDir'> & { ci?: boolean },
): Promise<PackageManager> {
  const detectedPackageManagers = detectAllPackageManagers({
    installDir: options.installDir,
  });

  // If exactly one package manager detected, use it automatically
  if (detectedPackageManagers.length === 1) {
    const detectedPackageManager = detectedPackageManagers[0];
    analytics.setTag('package-manager', detectedPackageManager.name);
    return detectedPackageManager;
  }

  // CI mode: auto-select first detected or npm
  if (options.ci) {
    const selectedPackageManager = detectedPackageManagers.length > 0 ? detectedPackageManagers[0] : npm;
    clack.log.info(`CI mode: auto-selected package manager: ${selectedPackageManager.label}`);
    analytics.setTag('package-manager', selectedPackageManager.name);
    return selectedPackageManager;
  }

  // If multiple or no package managers detected, prompt user to select
  const pkgOptions = detectedPackageManagers.length > 0 ? detectedPackageManagers : packageManagers;

  const message =
    detectedPackageManagers.length > 1
      ? 'Multiple package managers detected. Please select one:'
      : 'Please select your package manager.';

  const selectedPackageManager = await abortIfCancelled<PackageManager | symbol>(
    clack.select({
      message,
      options: pkgOptions.map((packageManager) => ({
        value: packageManager,
        label: packageManager.label,
      })),
    }),
  );

  analytics.setTag('package-manager', (selectedPackageManager as PackageManager).name);
  return selectedPackageManager as PackageManager;
}

export function isUsingTypeScript({ installDir }: Pick<WizardOptions, 'installDir'>) {
  try {
    return fs.existsSync(join(installDir, 'tsconfig.json'));
  } catch {
    return false;
  }
}

/**
 *
 * Use this function to get project data for the wizard.
 *
 * @param options wizard options
 * @returns project data (token, url)
 */
/**
 * Check for existing WorkOS credentials without prompting
 * Returns credentials if found, null if prompting is needed
 */
export function checkExistingCredentials(
  options: Pick<WizardOptions, 'apiKey' | 'clientId' | 'installDir'>,
  requireApiKey: boolean = true,
): { apiKey: string; clientId: string } | null {
  let apiKey = options.apiKey;
  let clientId = options.clientId;

  // If credentials provided via CLI, use them
  if ((!requireApiKey || apiKey) && clientId) {
    return { apiKey: apiKey || '', clientId };
  }

  // Check if credentials already exist in .env.local
  const envPath = join(options.installDir, '.env.local');
  if (fs.existsSync(envPath)) {
    try {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      const envVars = parseEnvFile(envContent);

      const existingApiKey = envVars.WORKOS_API_KEY;
      const existingClientId = envVars.WORKOS_CLIENT_ID;

      // Use existing credentials if both are present (or API key not required)
      if (existingClientId && (!requireApiKey || existingApiKey)) {
        return {
          apiKey: existingApiKey || '',
          clientId: existingClientId,
        };
      }
    } catch (error) {
      // If we can't read/parse .env.local, return null to prompt
      debug('Failed to read .env.local:', error);
    }
  }

  return null;
}

/**
 * Get WorkOS credentials (API Key and Client ID) from user or CLI options
 * @param requireApiKey - Whether API key is needed (false for client-only SDKs like React, Vanilla JS)
 */
export async function getOrAskForWorkOSCredentials(
  _options: Pick<WizardOptions, 'ci' | 'apiKey' | 'clientId' | 'installDir' | 'dashboard'>,
  requireApiKey: boolean = true,
): Promise<{
  apiKey: string;
  clientId: string;
}> {
  let apiKey = _options.apiKey;
  let clientId = _options.clientId;

  // If credentials provided via CLI (e.g., CI mode or dashboard mode), use them
  if ((!requireApiKey || apiKey) && clientId) {
    // Only log in non-dashboard mode
    if (!_options.dashboard) {
      clack.log.info('Using provided WorkOS credentials');
    }
    return { apiKey: apiKey || '', clientId };
  }

  // Check if credentials already exist in .env.local
  const envPath = join(_options.installDir, '.env.local');
  if (fs.existsSync(envPath)) {
    try {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      const envVars = parseEnvFile(envContent);

      const existingApiKey = envVars.WORKOS_API_KEY;
      const existingClientId = envVars.WORKOS_CLIENT_ID;

      // Use existing credentials if both are present (or API key not required)
      if (existingClientId && (!requireApiKey || existingApiKey)) {
        if (!_options.dashboard) {
          clack.log.success(`Found existing WorkOS credentials in .env.local`);
        }
        return {
          apiKey: existingApiKey || '',
          clientId: existingClientId,
        };
      }
    } catch (error) {
      // If we can't read/parse .env.local, just continue to prompt
      debug('Failed to read .env.local:', error);
    }
  }

  // Otherwise, prompt user for credentials
  clack.log.step(`Get your credentials from ${chalk.cyan('https://dashboard.workos.com')}`);

  if (requireApiKey && !apiKey) {
    clack.log.info(`${chalk.dim('ℹ️ Your API key will be hidden for security and saved to .env.local')}`);
    apiKey = (await abortIfCancelled(
      clack.password({
        message: 'Enter your WorkOS API Key',
        validate: (value: string) => {
          if (!value) return 'API Key is required';
          if (!value.startsWith('sk_')) {
            return 'API Key should start with sk_';
          }
          return undefined;
        },
      }),
    )) as string;
  } else if (!requireApiKey) {
    clack.log.info(`${chalk.dim('ℹ️ Client-only SDK - API key not required')}`);
  }

  if (!clientId) {
    clientId = (await abortIfCancelled(
      clack.text({
        message: 'Enter your WorkOS Client ID',
        placeholder: 'client_...',
        validate: (value: string) => {
          if (!value) return 'Client ID is required';
          if (!value.startsWith('client_')) {
            return 'Client ID should start with client_';
          }
          return undefined;
        },
      }),
    )) as string;
  }

  return { apiKey: apiKey || '', clientId };
}

/**
 * Fetch project data using a personal API key (for CI mode)
 */

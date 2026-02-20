import { existsSync } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import clack from '../utils/clack.js';
import type { InstallerOptions } from '../utils/types.js';
import { createInstallerEventEmitter } from '../lib/events.js';
import { CLIAdapter } from '../lib/adapters/cli-adapter.js';
import { DashboardAdapter } from '../lib/adapters/dashboard-adapter.js';
import type { InstallerAdapter } from '../lib/adapters/types.js';
import { analytics } from '../utils/analytics.js';
import { getVersion } from '../lib/settings.js';
import { getLlmGatewayUrlFromHost } from '../utils/urls.js';
import { enableDebugLogs, initLogFile, logInfo, logError } from '../utils/debug.js';
import { initializeAgent, runAgent } from '../lib/agent-interface.js';
import { runBuildValidation } from '../lib/validation/index.js';
import { detectWidgetsProject } from './detection.js';
import type { WidgetsDetectionResult, WidgetsEntry, WidgetsFramework, WidgetsWidget } from './types.js';
import { getPackageDotJson } from '../utils/clack-utils.js';
import { getNextJsRouter, NextJsRouter, getNextJsRouterName } from '../nextjs/utils.js';
import semver from 'semver';

export interface WidgetsInstallerOptions extends InstallerOptions {
  widget?: WidgetsWidget;
  widgetsEntry?: WidgetsEntry;
  widgetsFramework?: WidgetsFramework;
  widgetsPath?: string;
  widgetsPagePath?: string;
}

const WIDGETS_DOCS_URL = 'https://workos.com/docs/widgets/quick-start';
const WIDGETS_PACKAGE_NAME = '@workos-inc/widgets';
const WIDGETS_MIN_VERSION = '1.8.1';

const AUTHKIT_DEP_PREFIXES = ['@workos/authkit', '@workos-inc/authkit'];

const FRAMEWORK_CHOICES: Array<{ label: string; value: WidgetsFramework }> = [
  { label: 'Next.js', value: 'nextjs' },
  { label: 'React Router', value: 'react-router' },
  { label: 'TanStack Start', value: 'tanstack-start' },
  { label: 'TanStack Router', value: 'tanstack-router' },
  { label: 'Vite', value: 'vite' },
];

const WIDGET_CONFIG: Record<
  WidgetsWidget,
  {
    label: string;
    slug: string;
    componentBaseName: string;
    routeName: string;
    scopeHint: string;
  }
> = {
  'user-management': {
    label: 'User Management',
    slug: 'user-management',
    componentBaseName: 'user-management-widget',
    routeName: 'user-management',
    scopeHint: 'widgets:users-table:manage',
  },
  'user-profile': {
    label: 'User Profile',
    slug: 'user-profile',
    componentBaseName: 'user-profile-widget',
    routeName: 'user-profile',
    scopeHint: 'No special permissions are required to use this widget.',
  },
  'admin-portal-sso-connection': {
    label: 'Admin Portal SSO Connection',
    slug: 'admin-portal-sso-connection',
    componentBaseName: 'admin-portal-sso-connection-widget',
    routeName: 'admin-portal-sso-connection',
    scopeHint: 'widgets:sso:manage',
  },
  'admin-portal-domain-verification': {
    label: 'Admin Portal Domain Verification',
    slug: 'admin-portal-domain-verification',
    componentBaseName: 'admin-portal-domain-verification-widget',
    routeName: 'admin-portal-domain-verification',
    scopeHint: 'widgets:domain-verification:manage',
  },
};

function inferComponentPath(installDir: string, usesTypeScript: boolean, widget: WidgetsWidget): string {
  const ext = usesTypeScript ? 'tsx' : 'jsx';
  const componentName = WIDGET_CONFIG[widget].componentBaseName;
  const candidates = [
    path.join('src', 'components', 'workos', `${componentName}.${ext}`),
    path.join('components', 'workos', `${componentName}.${ext}`),
    path.join('src', `${componentName}.${ext}`),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(installDir, path.dirname(candidate)))) {
      return candidate;
    }
  }
  return candidates[0];
}

function inferPagePath(
  usesTypeScript: boolean,
  framework: WidgetsFramework,
  widget: WidgetsWidget,
  nextjsRouter?: NextJsRouter,
): string {
  const ext = usesTypeScript ? 'tsx' : 'jsx';
  const routeName = WIDGET_CONFIG[widget].routeName;
  if (framework === 'nextjs') {
    const router = nextjsRouter ?? NextJsRouter.APP_ROUTER;
    return router === NextJsRouter.APP_ROUTER
      ? path.join('app', 'widgets', routeName, `page.${ext}`)
      : path.join('pages', 'widgets', `${routeName}.${ext}`);
  }

  if (framework === 'vite') {
    return path.join('src', 'pages', `${toPascalCase(routeName)}.${ext}`);
  }

  return path.join('src', 'routes', `${routeName}.${ext}`);
}

function toPascalCase(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join('');
}

async function selectWidget(options: WidgetsInstallerOptions): Promise<WidgetsWidget> {
  if (options.widget && WIDGET_CONFIG[options.widget]) return options.widget;
  if (options.widget && !WIDGET_CONFIG[options.widget]) {
    throw new Error(`Unsupported widget "${options.widget}".`);
  }

  if (options.ci) {
    throw new Error('Could not determine widget. Provide --widget in CI mode.');
  }

  const selection = await clack.select({
    message: 'Which widget should WorkOS install?',
    options: Object.entries(WIDGET_CONFIG).map(([value, config]) => ({
      value,
      label: config.label,
    })),
  });

  if (clack.isCancel(selection)) {
    throw new Error('Installer cancelled by user');
  }

  return selection as WidgetsWidget;
}

function getFrameworkSkill(framework: WidgetsFramework): string {
  switch (framework) {
    case 'nextjs':
      return 'workos-widgets-framework-nextjs';
    case 'react-router':
      return 'workos-widgets-framework-react-router';
    case 'tanstack-start':
      return 'workos-widgets-framework-tanstack-start';
    case 'tanstack-router':
      return 'workos-widgets-framework-tanstack-router';
    case 'vite':
      return 'workos-widgets-framework-vite';
  }
}

function buildWidgetsPrompt(input: {
  framework: WidgetsFramework;
  entry: WidgetsEntry;
  widget: WidgetsWidget;
  componentPath: string;
  pagePath?: string;
  detection: WidgetsDetectionResult;
  nextjsRouter?: NextJsRouter;
}): string {
  const { framework, entry, widget, componentPath, pagePath, detection, nextjsRouter } = input;
  const widgetConfig = WIDGET_CONFIG[widget];
  const widgetSkill = `workos-widgets-${widget}`;
  const frameworkSkill = getFrameworkSkill(framework);
  const nextjsLine =
    framework === 'nextjs' && nextjsRouter ? `- Next.js Router: ${getNextJsRouterName(nextjsRouter)}` : '';

  return `You are installing WorkOS Widgets (${widgetConfig.label}) into this project.

## Project Context

- Framework: ${framework}
- Package Manager: ${detection.packageManager}
- TypeScript: ${detection.usesTypeScript ? 'Yes' : 'No'}
- Data Fetching: ${detection.dataFetching}
- Styling: ${detection.styling}
- Component System: ${detection.componentSystem}
${nextjsLine}

## Widget Setup

- Widget: ${widget}
- Entry: ${entry}
- Component Path: ${componentPath}${pagePath ? `\n- Page Path: ${pagePath}` : ''}
- Widgets package: ${WIDGETS_PACKAGE_NAME} (minimum ${WIDGETS_MIN_VERSION}, prefer latest)
- Use imports for selected data fetching mode:
  - fetch: ${WIDGETS_PACKAGE_NAME}/experimental/api/fetch
  - swr: ${WIDGETS_PACKAGE_NAME}/experimental/api/swr
  - react-query: ${WIDGETS_PACKAGE_NAME}/experimental/api/react-query
- API Host: use WORKOS_WIDGETS_API_URL, then WORKOS_API_HOST, else https://api.workos.com
- Scope guidance: ${widgetConfig.scopeHint}

Important constraints:
- Do NOT call fetch directly. Use exported functions from ${WIDGETS_PACKAGE_NAME}/experimental/api/${detection.dataFetching}.
- Discover available API functions by inspecting imports/usages in that package entrypoint and existing project imports.
- Always create both the widget component and the page/route, and ensure the route is wired.

## Auth

Prefer AuthKit access tokens (authkit-js/authkit-react) if already in use.
If server-side token generation is used, call:
const token = await workos.widgets.getToken({ userId, organizationId, scopes: ['widgets:users-table:manage'] })

## Task

Use the \`${frameworkSkill}\` skill to create the page/route and token plumbing.
Inside that skill, invoke \`${widgetSkill}\` to generate the ${widgetConfig.label} widget component.
Prefer existing UI components. If shadcn is detected and required components are missing, run shadcn CLI to add them.`;
}

async function hasAuthKitInstalled(installDir: string): Promise<boolean> {
  try {
    const pkg = await getPackageDotJson({ installDir });
    const deps = Object.keys({
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    });
    return deps.some((name) => AUTHKIT_DEP_PREFIXES.some((prefix) => name.startsWith(prefix)));
  } catch {
    return false;
  }
}

function getWidgetsInstallCommand(packageManager: string): string {
  switch (packageManager) {
    case 'pnpm':
      return `pnpm add ${WIDGETS_PACKAGE_NAME}@latest`;
    case 'yarn':
      return `yarn add ${WIDGETS_PACKAGE_NAME}@latest`;
    case 'bun':
      return `bun add ${WIDGETS_PACKAGE_NAME}@latest`;
    case 'npm':
    default:
      return `npm install ${WIDGETS_PACKAGE_NAME}@latest`;
  }
}

async function ensureWidgetsPackage(installDir: string, packageManager: string): Promise<void> {
  const pkg = await getPackageDotJson({ installDir });
  const currentVersion = pkg.dependencies?.[WIDGETS_PACKAGE_NAME] ?? pkg.devDependencies?.[WIDGETS_PACKAGE_NAME];

  const coerced = currentVersion ? semver.coerce(currentVersion) : null;
  const hasMinVersion = coerced ? semver.gte(coerced.version, WIDGETS_MIN_VERSION) : false;
  const installCommand = getWidgetsInstallCommand(packageManager);

  if (!currentVersion) {
    logInfo(`Installing ${WIDGETS_PACKAGE_NAME}@latest`);
    execSync(installCommand, { cwd: installDir, stdio: 'pipe' });
    return;
  }

  if (!hasMinVersion) {
    logInfo(`Upgrading ${WIDGETS_PACKAGE_NAME} to latest (current: ${currentVersion})`);
    execSync(installCommand, { cwd: installDir, stdio: 'pipe' });
    return;
  }

  // User asked to keep this package fresh if present.
  logInfo(`Refreshing ${WIDGETS_PACKAGE_NAME} to latest (current: ${currentVersion})`);
  execSync(installCommand, { cwd: installDir, stdio: 'pipe' });
}

async function selectFramework(
  detectedFramework: WidgetsFramework | undefined,
  options: WidgetsInstallerOptions,
): Promise<WidgetsFramework> {
  if (options.widgetsFramework) return options.widgetsFramework;
  if (detectedFramework) return detectedFramework;
  if (options.ci) {
    throw new Error('Could not detect framework. Provide --widgets-framework in CI mode.');
  }

  const selection = await clack.select({
    message: 'Which framework should WorkOS Widgets use?',
    options: FRAMEWORK_CHOICES,
  });

  if (clack.isCancel(selection)) {
    throw new Error('Installer cancelled by user');
  }

  return selection as WidgetsFramework;
}

async function resolveComponentPath(
  installDir: string,
  usesTypeScript: boolean,
  widget: WidgetsWidget,
  options: WidgetsInstallerOptions,
): Promise<string> {
  if (options.widgetsPath) return options.widgetsPath;

  const defaultPath = inferComponentPath(installDir, usesTypeScript, widget);

  if (options.ci) {
    return defaultPath;
  }

  const response = await clack.text({
    message: 'Where should the widget component live?',
    initialValue: defaultPath,
  });

  if (clack.isCancel(response)) {
    throw new Error('Installer cancelled by user');
  }

  return response.trim() || defaultPath;
}

async function resolvePagePath(
  usesTypeScript: boolean,
  framework: WidgetsFramework,
  widget: WidgetsWidget,
  nextjsRouter: NextJsRouter | undefined,
  options: WidgetsInstallerOptions,
): Promise<string | undefined> {
  if (options.widgetsEntry === 'component') return undefined;
  if (options.widgetsPagePath) return options.widgetsPagePath;

  const defaultPath = inferPagePath(usesTypeScript, framework, widget, nextjsRouter);

  if (options.ci) {
    return defaultPath;
  }

  const response = await clack.text({
    message: 'Where should the widget page/route live?',
    initialValue: defaultPath,
  });

  if (clack.isCancel(response)) {
    throw new Error('Installer cancelled by user');
  }

  return response.trim() || defaultPath;
}

export async function runWidgetsInstaller(options: WidgetsInstallerOptions): Promise<void> {
  initLogFile();
  if (options.debug) {
    enableDebugLogs();
  }

  let adapter: InstallerAdapter | null = null;
  let emitter: ReturnType<typeof createInstallerEventEmitter> | null = null;
  let installerOptions: WidgetsInstallerOptions | null = null;

  try {
    const authKitInstalled = await hasAuthKitInstalled(options.installDir);
    if (!authKitInstalled) {
      if (options.ci) {
        throw new Error('AuthKit is required. Run `workos install` before installing Widgets.');
      }

      clack.log.warn('AuthKit is required before installing Widgets.');
      const runAuthKit = await clack.confirm({
        message: 'Run AuthKit installer now?',
        initialValue: true,
      });

      if (clack.isCancel(runAuthKit) || !runAuthKit) {
        throw new Error(`AuthKit is required. See ${WIDGETS_DOCS_URL}`);
      }

      const { runInstaller } = await import('../run.js');
      await runInstaller({
        ...options,
        integration: undefined,
      });
    }

    const selectedWidget: WidgetsWidget = await selectWidget(options);

    if (options.widgetsEntry && options.widgetsEntry === 'component') {
      throw new Error('Widgets install requires both a component and a page.');
    }

    emitter = createInstallerEventEmitter();
    adapter = options.dashboard
      ? new DashboardAdapter({ emitter, sendEvent: () => {}, debug: options.debug })
      : new CLIAdapter({ emitter, sendEvent: () => {}, debug: options.debug, productName: 'Widgets' });

    const mode = options.dashboard ? 'tui' : 'cli';
    analytics.setGatewayUrl(getLlmGatewayUrlFromHost());

    installerOptions = {
      ...options,
      emitter,
    };

    await adapter.start();
    analytics.sessionStart(mode, getVersion());

    let status: 'success' | 'error' | 'cancelled' = 'success';

    emitter.emit('state:enter', { state: 'authenticating' });
    emitter.emit('state:exit', { state: 'authenticating' });

    emitter.emit('state:enter', { state: 'preparing' });
    emitter.emit('detection:start', {});
    const detection = await detectWidgetsProject(installerOptions);
    const framework = await selectFramework(detection.framework, installerOptions);
    const nextjsRouter =
      framework === 'nextjs'
        ? installerOptions.ci
          ? NextJsRouter.APP_ROUTER
          : await getNextJsRouter(installerOptions)
        : undefined;
    emitter.emit('detection:complete', { integration: framework });
    emitter.emit('state:exit', { state: 'preparing' });

    emitter.emit('state:enter', { state: 'gatheringCredentials' });
    emitter.emit('state:exit', { state: 'gatheringCredentials' });

    emitter.emit('state:enter', { state: 'configuring' });
    const componentPath = await resolveComponentPath(
      installerOptions.installDir,
      detection.usesTypeScript,
      selectedWidget,
      installerOptions,
    );
    const entry: WidgetsEntry = 'both';
    const pagePath = await resolvePagePath(detection.usesTypeScript, framework, selectedWidget, nextjsRouter, {
      ...installerOptions,
      widgetsEntry: entry,
    });
    if (!pagePath) {
      throw new Error('Widgets install requires a page path. Provide --widgets-page-path if needed.');
    }
    await ensureWidgetsPackage(installerOptions.installDir, detection.packageManager);
    logInfo(`Ensured ${WIDGETS_PACKAGE_NAME} is installed and up to date`);
    emitter.emit('state:exit', { state: 'configuring' });

    emitter.emit('state:enter', { state: 'runningAgent' });
    emitter.emit('agent:start', {});

    const prompt = buildWidgetsPrompt({
      framework,
      entry,
      widget: selectedWidget,
      componentPath,
      pagePath,
      detection,
      nextjsRouter,
    });

    const agent = await initializeAgent(
      {
        workingDirectory: installerOptions.installDir,
        workOSApiKey: installerOptions.apiKey ?? '',
        workOSApiHost: 'https://api.workos.com',
      },
      installerOptions,
    );

    const agentResult = await runAgent(
      agent,
      prompt,
      installerOptions,
      {
        spinnerMessage: `Setting up WorkOS Widgets (${WIDGET_CONFIG[selectedWidget].label})...`,
        successMessage: 'WorkOS Widgets setup complete',
        errorMessage: 'Widgets integration failed',
      },
      emitter,
    );

    if (agentResult.error) {
      emitter.emit('agent:failure', {
        message: agentResult.errorMessage || agentResult.error,
        stack: undefined,
      });
      throw new Error(agentResult.errorMessage || agentResult.error);
    }

    emitter.emit('agent:success', { summary: 'Widgets setup complete' });
    emitter.emit('state:exit', { state: 'runningAgent' });

    if (!installerOptions.noValidate) {
      emitter.emit('validation:start', { framework: 'widgets' });
      const buildResult = await runBuildValidation(installerOptions.installDir);
      if (buildResult.issues.length > 0) {
        emitter.emit('validation:issues', { issues: buildResult.issues });
      }
      emitter.emit('validation:complete', {
        passed: buildResult.issues.filter((issue) => issue.severity === 'error').length === 0,
        issueCount: buildResult.issues.length,
        durationMs: buildResult.durationMs,
      });
    }

    emitter.emit('complete', {
      success: true,
      product: 'widgets',
      summary: `Created ${WIDGET_CONFIG[selectedWidget].label} widget (${componentPath}) and page (${pagePath ?? 'n/a'}).`,
    });

    await analytics.shutdown('success');
    await adapter.stop();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Widgets installation failed';
    logError('Widgets installer failed:', error);
    if (emitter) {
      emitter.emit('error', { message });
      emitter.emit('complete', { success: false, summary: message, product: 'widgets' });
    }
    await analytics.shutdown('error');
    if (adapter) {
      await adapter.stop();
    }
    throw error;
  }
}

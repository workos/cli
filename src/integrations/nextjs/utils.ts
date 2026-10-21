import fg from 'fast-glob';
import ui from '../../utils/ui.js';
import { getVersionBucket } from '../../utils/semver.js';
import type { InstallerOptions } from '../../utils/types.js';
import { IGNORE_PATTERNS } from '../../lib/constants.js';
import { InstallDeclinedError } from '../../lib/installer-errors.js';

export function getNextJsVersionBucket(version: string | undefined): string {
  return getVersionBucket(version, 11);
}

export enum NextJsRouter {
  APP_ROUTER = 'app-router',
  PAGES_ROUTER = 'pages-router',
}

/** The SDK uses App Router request/cookie APIs; Pages Router handlers are not compatible. */
export function assertSupportedNextJsRouter(router: NextJsRouter): void {
  if (router !== NextJsRouter.PAGES_ROUTER) return;
  const message =
    'AuthKit for Next.js supports App Router only. This installer cannot configure Pages Router. ' +
    'Use an App Router project or follow the manual setup guide: https://workos.com/docs/authkit/nextjs';
  ui.log.warn(message);
  throw new InstallDeclinedError(message, 'unsupported_nextjs_router');
}

export async function getNextJsRouter({
  installDir,
  router,
}: Pick<InstallerOptions, 'installDir' | 'router'>): Promise<NextJsRouter> {
  // TypeScript and yargs constrain normal callers, but runtime input must not
  // silently turn an unsupported selection into permission to change App Router files.
  if (router !== undefined && router !== 'app') {
    const message =
      'Unsupported Next.js router selection. Only App Router is supported; use --router app or omit --router.';
    ui.log.warn(message);
    throw new InstallDeclinedError(message, 'unsupported_nextjs_router');
  }
  const pagesMatches = await fg('**/pages/_app.@(ts|tsx|js|jsx)', {
    dot: true,
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  const hasPagesDir = pagesMatches.length > 0;

  const appMatches = await fg('**/app/**/layout.@(ts|tsx|js|jsx)', {
    dot: true,
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  const hasAppDir = appMatches.length > 0;

  if (hasPagesDir && !hasAppDir) {
    ui.log.detail(`Detected ${getNextJsRouterName(NextJsRouter.PAGES_ROUTER)}`);
    return NextJsRouter.PAGES_ROUTER;
  }

  if (hasAppDir && !hasPagesDir) {
    ui.log.detail(`Detected ${getNextJsRouterName(NextJsRouter.APP_ROUTER)}`);
    return NextJsRouter.APP_ROUTER;
  }

  // Only App Router is supported. Do not offer a Pages Router choice that the
  // installer will subsequently reject. Mixed projects keep their pages tree.
  if (hasPagesDir && hasAppDir) {
    ui.log.warn('Only App Router is supported. Using App Router; Pages Router routes will not be configured.');
  }
  return NextJsRouter.APP_ROUTER;
}

/** Route groups change file locations, not the public URL. */
export function nextjsRoutePath(file: string): string {
  const segments = file
    .replace(/^(src\/)?app\//, '')
    .split('/')
    .slice(0, -1);
  return '/' + segments.filter((segment) => !/^\(.*\)$/.test(segment)).join('/');
}

export async function findNextjsSignInPage(installDir: string): Promise<string | undefined> {
  const pages = await fg('{,src/}app/**/sign-in/page.{ts,tsx,js,jsx}', { cwd: installDir, ignore: IGNORE_PATTERNS });
  return pages.find((file) => nextjsRoutePath(file) === '/sign-in');
}

/** The current installer owns /sign-in; never overwrite a page at that URL. */
export async function assertNextjsSignInRouteAvailable(installDir: string): Promise<void> {
  if (await findNextjsSignInPage(installDir)) {
    const message =
      'This installer requires a dedicated /sign-in route, but a page already serves that URL. ' +
      'It was left unchanged. Configure AuthKit manually or move that page before running the installer.';
    ui.log.warn(message);
    throw new InstallDeclinedError(message, 'conflicting_sign_in_route');
  }
}

export const getNextJsRouterName = (router: NextJsRouter) => {
  return router === NextJsRouter.APP_ROUTER ? 'app router' : 'pages router';
};

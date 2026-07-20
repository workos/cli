import fg from 'fast-glob';
import { abortIfCancelled } from '../../utils/clack-utils.js';
import clack from '../../utils/clack.js';
import { getVersionBucket } from '../../utils/semver.js';
import type { InstallerOptions } from '../../utils/types.js';
import { IGNORE_PATTERNS } from '../../lib/constants.js';
import { isPromptAllowed } from '../../utils/interaction-mode.js';

export function getNextJsVersionBucket(version: string | undefined): string {
  return getVersionBucket(version, 11);
}

export enum NextJsRouter {
  APP_ROUTER = 'app-router',
  PAGES_ROUTER = 'pages-router',
}

export async function getNextJsRouter({
  installDir,
  router,
}: Pick<InstallerOptions, 'installDir' | 'router'>): Promise<NextJsRouter> {
  // Explicit flag wins over detection (deterministic for agents).
  if (router) {
    const chosen = router === 'pages' ? NextJsRouter.PAGES_ROUTER : NextJsRouter.APP_ROUTER;
    clack.log.info(`Using ${getNextJsRouterName(chosen)} (--router)`);
    return chosen;
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
    clack.log.info(`Detected ${getNextJsRouterName(NextJsRouter.PAGES_ROUTER)} 📃`);
    return NextJsRouter.PAGES_ROUTER;
  }

  if (hasAppDir && !hasPagesDir) {
    clack.log.info(`Detected ${getNextJsRouterName(NextJsRouter.APP_ROUTER)} 📱`);
    return NextJsRouter.APP_ROUTER;
  }

  // Ambiguous (both app/ and pages/ present, or neither). In non-interactive
  // mode default to the app router (dominant/new-project case) with a warning
  // instead of prompting — the --router flag above is the escape hatch.
  if (!isPromptAllowed()) {
    clack.log.warn(
      'Could not determine the Next.js router (both app/ and pages/ present, or neither). ' +
        'Defaulting to app router. Pass --router app|pages to override.',
    );
    return NextJsRouter.APP_ROUTER;
  }

  const result: NextJsRouter = await abortIfCancelled(
    clack.select({
      message: 'What router are you using?',
      options: [
        {
          label: getNextJsRouterName(NextJsRouter.APP_ROUTER),
          value: NextJsRouter.APP_ROUTER,
        },
        {
          label: getNextJsRouterName(NextJsRouter.PAGES_ROUTER),
          value: NextJsRouter.PAGES_ROUTER,
        },
      ],
    }),
    'nextjs',
  );

  return result;
}

export const getNextJsRouterName = (router: NextJsRouter) => {
  return router === NextJsRouter.APP_ROUTER ? 'app router' : 'pages router';
};

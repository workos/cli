import type { IntegrationModule } from '../lib/registry.js';

/**
 * Static manifest of every integration, keyed by directory name.
 *
 * Why a hand-maintained map instead of scanning the filesystem: a Bun-compiled
 * binary has no `dist/integrations/` on disk to `readdirSync`, and the bundler
 * can only embed modules it can see statically. Literal dynamic `import()`
 * specifiers ARE statically analyzable, so each loader below gets bundled while
 * staying lazy (loaded only when its integration is actually used).
 *
 * The `_manifest.spec.ts` drift guard fails CI if this list diverges from the
 * integration directories, so "add a dir, forget the manifest" can't ship.
 */
export const integrationLoaders: Record<string, () => Promise<IntegrationModule>> = {
  dotnet: () => import('./dotnet/index.js'),
  elixir: () => import('./elixir/index.js'),
  go: () => import('./go/index.js'),
  kotlin: () => import('./kotlin/index.js'),
  nextjs: () => import('./nextjs/index.js'),
  node: () => import('./node/index.js'),
  php: () => import('./php/index.js'),
  'php-laravel': () => import('./php-laravel/index.js'),
  python: () => import('./python/index.js'),
  react: () => import('./react/index.js'),
  'react-router': () => import('./react-router/index.js'),
  ruby: () => import('./ruby/index.js'),
  sveltekit: () => import('./sveltekit/index.js'),
  'tanstack-start': () => import('./tanstack-start/index.js'),
  'vanilla-js': () => import('./vanilla-js/index.js'),
};

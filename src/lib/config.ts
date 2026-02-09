/**
 * Integration detection configuration.
 *
 * This module previously held hardcoded INTEGRATION_CONFIG and INTEGRATION_ORDER.
 * These are now provided by the auto-discovery registry (src/lib/registry.ts).
 *
 * This file is kept for backwards compatibility — functions that previously
 * used INTEGRATION_CONFIG now delegate to the registry.
 */

import { getPackageDotJson } from '../utils/clack-utils.js';
import { hasPackageInstalled } from '../utils/package-json.js';
import type { InstallerOptions } from '../utils/types.js';
import type { Integration } from './constants.js';

/**
 * @deprecated Use registry.detectionOrder() + config.detection.detect() instead.
 * This type is kept for any code that still references it.
 */
export type IntegrationConfig = {
  name: string;
  filterPatterns: string[];
  ignorePatterns: string[];
  detect: (options: Pick<InstallerOptions, 'installDir'>) => Promise<boolean>;
  generateFilesRules: string;
  filterFilesRules: string;
  docsUrl: string;
  nextSteps: string;
  defaultChanges: string;
};

/**
 * Legacy detection configs for existing JS integrations.
 * Used by clack-utils.ts for abort/cancel messages.
 * New integrations do NOT need to be added here.
 */
export const INTEGRATION_CONFIG: Record<string, { docsUrl: string; name: string }> = {
  nextjs: {
    name: 'Next.js',
    docsUrl: 'https://workos.com/docs/user-management/authkit/nextjs',
  },
  react: {
    name: 'React (SPA)',
    docsUrl: 'https://workos.com/docs/user-management/authkit/react',
  },
  'tanstack-start': {
    name: 'TanStack Start',
    docsUrl: 'https://workos.com/docs/user-management/authkit/tanstack-start',
  },
  'react-router': {
    name: 'React Router',
    docsUrl: 'https://workos.com/docs/user-management/authkit/react-router',
  },
  'vanilla-js': {
    name: 'Vanilla JavaScript',
    docsUrl: 'https://workos.com/docs/user-management/authkit/javascript',
  },
};

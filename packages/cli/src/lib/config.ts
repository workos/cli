import { getPackageDotJson } from '../utils/clack-utils';
import { hasPackageInstalled } from '../utils/package-json';
import type { WizardOptions } from '../utils/types';
import { Integration } from './constants';

type IntegrationConfig = {
  name: string;
  filterPatterns: string[];
  ignorePatterns: string[];
  detect: (options: Pick<WizardOptions, 'installDir'>) => Promise<boolean>;
  generateFilesRules: string;
  filterFilesRules: string;
  docsUrl: string;
  nextSteps: string;
  defaultChanges: string;
};

export const INTEGRATION_CONFIG = {
  [Integration.nextjs]: {
    name: 'Next.js',
    filterPatterns: ['**/*.{tsx,ts,jsx,js,mjs,cjs}'],
    ignorePatterns: [
      'node_modules',
      'dist',
      'build',
      'public',
      'static',
      'next-env.d.*',
    ],
    detect: async (options) => {
      const packageJson = await getPackageDotJson(options);
      return hasPackageInstalled('next', packageJson);
    },
    generateFilesRules: '',
    filterFilesRules: '',
    docsUrl: 'https://workos.com/docs/user-management/authkit/nextjs',
    defaultChanges:
      '• Installed @workos/authkit-nextjs package\n• Initialized WorkOS AuthKit with your credentials\n• Created authentication routes and callbacks\n• Added login/logout UI components',
    nextSteps:
      '• Customize the auth UI to match your app design\n• Add protected routes using withAuth() middleware\n• Access user session with getUser() in your components',
  },
  [Integration.react]: {
    name: 'React (SPA)',
    filterPatterns: ['**/*.{tsx,ts,jsx,js}'],
    ignorePatterns: [
      'node_modules',
      'dist',
      'build',
      'public',
      'static',
      'assets',
    ],
    detect: async (options) => {
      const packageJson = await getPackageDotJson(options);
      // Detect React without routing frameworks
      const hasReact = hasPackageInstalled('react', packageJson);
      const hasNext = hasPackageInstalled('next', packageJson);
      const hasReactRouter = hasPackageInstalled('react-router', packageJson);
      const hasTanstack = hasPackageInstalled(
        '@tanstack/react-start',
        packageJson,
      );
      return hasReact && !hasNext && !hasReactRouter && !hasTanstack;
    },
    generateFilesRules: '',
    filterFilesRules: '',
    docsUrl: 'https://workos.com/docs/user-management/authkit/react',
    defaultChanges:
      '• Installed @workos/authkit-react package\n• Added AuthKitProvider to wrap your app\n• Created login and callback components',
    nextSteps:
      '• Use useAuth() hook to access auth state in components\n• Add protected routes with conditional rendering\n• Customize auth UI to match your design',
  },
  [Integration.tanstackStart]: {
    name: 'TanStack Start',
    filterPatterns: ['**/*.{tsx,ts,jsx,js}'],
    ignorePatterns: ['node_modules', 'dist', 'build', '.vinxi', '.output'],
    detect: async (options) => {
      const packageJson = await getPackageDotJson(options);
      return hasPackageInstalled('@tanstack/react-start', packageJson);
    },
    generateFilesRules: '',
    filterFilesRules: '',
    docsUrl: 'https://workos.com/docs/user-management/authkit/tanstack-start',
    defaultChanges:
      '• Installed @workos/authkit-tanstack-start package\n• Added AuthKit middleware and routes\n• Created authentication components',
    nextSteps:
      '• Use useAuth() hook to access auth state\n• Add protected routes with authentication checks\n• Customize auth UI to match your app',
  },
  [Integration.reactRouter]: {
    name: 'React Router',
    filterPatterns: ['**/*.{tsx,ts,jsx,js}'],
    ignorePatterns: [
      'node_modules',
      'dist',
      'build',
      'public',
      'static',
      'assets',
    ],
    detect: async (options) => {
      const packageJson = await getPackageDotJson(options);
      return hasPackageInstalled('react-router', packageJson);
    },
    generateFilesRules: '',
    filterFilesRules: '',
    docsUrl: 'https://workos.com/docs/user-management/authkit/react-router',
    defaultChanges:
      '• Installed @workos/authkit-react-router package\n• Added AuthKitProvider with React Router integration\n• Created auth routes and loaders',
    nextSteps:
      '• Use useAuth() hook in your components\n• Add protected routes with loader functions\n• Customize auth flow to match your needs',
  },
  [Integration.vanillaJs]: {
    name: 'Vanilla JavaScript',
    filterPatterns: ['**/*.{html,js,ts}'],
    ignorePatterns: ['node_modules', 'dist', 'build'],
    detect: async (options) => {
      // Fallback: if no framework detected, assume vanilla JS
      return true;
    },
    generateFilesRules: '',
    filterFilesRules: '',
    docsUrl: 'https://workos.com/docs/user-management/authkit/javascript',
    defaultChanges:
      '• Installed @workos/authkit-js package (or added CDN script)\n• Created auth initialization and callback handling\n• Added login button and auth state display',
    nextSteps:
      '• Integrate auth state into your existing UI\n• Add logout functionality where needed\n• Protect pages that require authentication',
  },
} as const satisfies Record<Integration, IntegrationConfig>;

export const INTEGRATION_ORDER = [
  Integration.nextjs,
  Integration.tanstackStart,
  Integration.reactRouter,
  Integration.react,
  Integration.vanillaJs, // fallback
] as const;

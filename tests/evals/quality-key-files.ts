/**
 * Key files per framework for quality grading.
 *
 * These are the integration-critical files the LLM should evaluate.
 * Patterns use fast-glob syntax. Order matters - first match wins for each pattern.
 */
export const QUALITY_KEY_FILES: Record<string, string[]> = {
  nextjs: [
    // Middleware - auth protection layer
    'middleware.ts',
    // Callback route - OAuth handling
    'app/**/callback/**/route.ts',
    'app/auth/callback/route.ts',
    // Provider - client-side auth context
    'app/**/providers.tsx',
    'app/providers.tsx',
    'app/layout.tsx',
  ],

  react: [
    // Entry point - AuthKitProvider setup
    'src/main.tsx',
    'src/index.tsx',
    // App component - useAuth usage
    'src/App.tsx',
    // Auth-specific components if they exist
    'src/auth/**/*.tsx',
    'src/components/auth/**/*.tsx',
  ],

  'react-router': [
    // Callback route - authLoader
    'app/routes/**/callback*.tsx',
    'src/routes/**/callback*.tsx',
    // Root - authkitLoader setup
    'app/root.tsx',
    'src/root.tsx',
    // Auth utilities
    'app/lib/auth*.ts',
    'src/lib/auth*.ts',
  ],

  'tanstack-start': [
    // Middleware config
    'src/start.ts',
    'app/start.ts',
    // Callback route - handleCallbackRoute
    'src/routes/**/callback*.tsx',
    'app/routes/**/callback*.tsx',
    // Router - middleware registration
    'src/router.tsx',
    'app/router.tsx',
  ],

  'vanilla-js': [
    // Main entry script
    'src/main.js',
    'src/index.js',
    'main.js',
    'index.js',
    // Auth module if separated
    'src/auth.js',
    'auth.js',
    // HTML entry
    'index.html',
  ],
};

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

  // New SDKs
  sveltekit: [
    'src/hooks.server.ts',
    'src/routes/callback/+server.ts',
    'src/routes/+layout.server.ts',
    'src/routes/+page.svelte',
  ],
  node: ['server.js', 'server.ts', 'src/index.ts', 'index.html'],
  python: ['server.py', 'app.py', 'index.html'],
  ruby: ['server.rb', 'app.rb', 'index.html'],
  go: ['main.go', 'handlers/**/*.go', 'auth/**/*.go'],
  php: ['public/index.php', 'login.php', 'callback.php'],
  'php-laravel': [
    'app/Http/Controllers/*Auth*.php',
    'routes/web.php',
    'config/workos.php',
  ],
  kotlin: [
    'src/main/kotlin/**/*Controller*.kt',
    'src/main/resources/application.properties',
  ],
  dotnet: ['Program.cs', '*.csproj'],
  elixir: [
    'lib/*_web/controllers/*auth*.ex',
    'lib/*_web/router.ex',
    'config/runtime.exs',
  ],
};

import * as fs from 'node:fs';
import { join } from 'node:path';
import type { Integration } from './constants.js';
import { getConfig } from './settings.js';

const settings = getConfig();

const INTEGRATION_TO_SETTINGS_KEY: Record<string, string> = {
  nextjs: 'nextjs',
  react: 'react',
  'tanstack-start': 'tanstackStart',
  'react-router': 'reactRouter',
  'vanilla-js': 'vanillaJs',
  python: 'python',
  ruby: 'ruby',
  php: 'php',
  'php-laravel': 'phpLaravel',
  go: 'go',
  dotnet: 'dotnet',
  elixir: 'elixir',
  kotlin: 'kotlin',
};

const DEFAULT_PORT = 3000;
const DEFAULT_CALLBACK_PATH = '/auth/callback';

function getDefaultPort(integration: Integration): number {
  const settingsKey = INTEGRATION_TO_SETTINGS_KEY[integration];
  return settings.frameworks[settingsKey]?.port ?? DEFAULT_PORT;
}

export function getCallbackPath(integration: Integration): string {
  const settingsKey = INTEGRATION_TO_SETTINGS_KEY[integration];
  return settings.frameworks[settingsKey]?.callbackPath ?? DEFAULT_CALLBACK_PATH;
}

/**
 * Parse port from Vite config file.
 * Looks for server.port in vite.config.{ts,js,mjs}
 */
function parseViteConfigPort(configPath: string): number | null {
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    // Match: port: 3000 or port: "3000" or port: '3000'
    const portMatch = content.match(/port\s*:\s*['"]?(\d+)['"]?/);
    if (portMatch) {
      return parseInt(portMatch[1], 10);
    }
  } catch {
    // File doesn't exist or can't be read
  }
  return null;
}

/**
 * Parse port from Next.js package.json scripts.
 * Next.js uses: "dev": "next dev -p 4000" or --port 4000
 */
function parseNextConfigPort(installDir: string): number | null {
  try {
    const packageJsonPath = join(installDir, 'package.json');
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);

    const devScript = packageJson.scripts?.dev || '';
    // Match: -p 4000, --port 4000, --port=4000
    const portMatch = devScript.match(/-p\s+(\d+)|--port[=\s]+(\d+)/);
    if (portMatch) {
      return parseInt(portMatch[1] || portMatch[2], 10);
    }
  } catch {
    // Can't read package.json
  }
  return null;
}

/**
 * Parse port from TanStack Start app.config.ts.
 * Uses Vinxi: server: { port: N }
 */
function parseTanStackPort(installDir: string): number | null {
  const configPaths = [join(installDir, 'app.config.ts'), join(installDir, 'app.config.js')];

  for (const configPath of configPaths) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      // Match server config with port
      const portMatch = content.match(/server\s*:\s*\{[^}]*port\s*:\s*(\d+)/);
      if (portMatch) {
        return parseInt(portMatch[1], 10);
      }
    } catch {
      // Config file doesn't exist
    }
  }
  return null;
}

/**
 * Parse port from .NET Properties/launchSettings.json.
 * VS/Rider scaffold: profiles[*].applicationUrl = "http://localhost:5000;https://localhost:5001"
 */
function parseDotnetPort(installDir: string): number | null {
  try {
    const configPath = join(installDir, 'Properties', 'launchSettings.json');
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content) as { profiles?: Record<string, { applicationUrl?: string }> };
    for (const profile of Object.values(parsed.profiles ?? {})) {
      const match = profile.applicationUrl?.match(/http:\/\/[^:/]+:(\d+)/);
      if (match) return parseInt(match[1], 10);
    }
  } catch {
    // File doesn't exist or can't parse
  }
  return null;
}

/**
 * Parse port from Phoenix config/dev.exs or config/runtime.exs.
 * Looks for `port: NNNN` — typically inside `http: [...]` but a bare regex is fine.
 */
function parseElixirPort(installDir: string): number | null {
  for (const relPath of ['config/dev.exs', 'config/runtime.exs']) {
    try {
      const content = fs.readFileSync(join(installDir, relPath), 'utf-8');
      const match = content.match(/port:\s*(\d+)/);
      if (match) return parseInt(match[1], 10);
    } catch {
      // skip
    }
  }
  return null;
}

/**
 * Parse port from Spring Boot application.properties or application.yml.
 * Both the default `src/main/resources/` location and a top-level file are checked.
 */
function parseKotlinPort(installDir: string): number | null {
  const propsPaths = [
    join(installDir, 'src', 'main', 'resources', 'application.properties'),
    join(installDir, 'application.properties'),
  ];
  for (const propsPath of propsPaths) {
    try {
      const content = fs.readFileSync(propsPath, 'utf-8');
      const match = content.match(/^server\.port\s*=\s*(\d+)/m);
      if (match) return parseInt(match[1], 10);
    } catch {
      // skip
    }
  }

  const ymlPaths = [
    join(installDir, 'src', 'main', 'resources', 'application.yml'),
    join(installDir, 'src', 'main', 'resources', 'application.yaml'),
    join(installDir, 'application.yml'),
    join(installDir, 'application.yaml'),
  ];
  for (const ymlPath of ymlPaths) {
    try {
      const content = fs.readFileSync(ymlPath, 'utf-8');
      // `server:\n  port: 8080` — shallow YAML parse via regex
      const match = content.match(/server\s*:\s*\n[^\S\n]+port\s*:\s*(\d+)/);
      if (match) return parseInt(match[1], 10);
    } catch {
      // skip
    }
  }
  return null;
}

/**
 * Parse port from Rails config/puma.rb.
 * Common forms:
 *   port ENV.fetch("PORT") { 3000 }
 *   port ENV.fetch("PORT", 3000)
 *   port 3000
 */
function parseRubyPort(installDir: string): number | null {
  try {
    const configPath = join(installDir, 'config', 'puma.rb');
    const content = fs.readFileSync(configPath, 'utf-8');
    const blockFetch = content.match(/port\s+ENV\.fetch\([^)]*\)\s*\{\s*(\d+)\s*\}/);
    if (blockFetch) return parseInt(blockFetch[1], 10);
    const argFetch = content.match(/port\s+ENV\.fetch\([^,]+,\s*(\d+)\)/);
    if (argFetch) return parseInt(argFetch[1], 10);
    const literal = content.match(/^\s*port\s+(\d+)/m);
    if (literal) return parseInt(literal[1], 10);
  } catch {
    // skip
  }
  return null;
}

/**
 * Detect the dev server port for a framework.
 * Checks config files first, falls back to framework default.
 */
export function detectPort(integration: Integration, installDir: string): number {
  let detectedPort: number | null = null;

  switch (integration) {
    case 'nextjs':
      detectedPort = parseNextConfigPort(installDir);
      break;

    case 'tanstack-start':
      detectedPort = parseTanStackPort(installDir);
      break;

    case 'react':
    case 'react-router':
    case 'vanilla-js': {
      // Vite-based frameworks
      const viteConfigs = [
        join(installDir, 'vite.config.ts'),
        join(installDir, 'vite.config.js'),
        join(installDir, 'vite.config.mjs'),
      ];
      for (const configPath of viteConfigs) {
        detectedPort = parseViteConfigPort(configPath);
        if (detectedPort) break;
      }
      break;
    }

    case 'dotnet':
      detectedPort = parseDotnetPort(installDir);
      break;

    case 'elixir':
      detectedPort = parseElixirPort(installDir);
      break;

    case 'kotlin':
      detectedPort = parseKotlinPort(installDir);
      break;

    case 'ruby':
      detectedPort = parseRubyPort(installDir);
      break;
  }

  return detectedPort ?? getDefaultPort(integration);
}

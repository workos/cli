import * as fs from 'node:fs';
import { join } from 'node:path';
import type { Integration } from './constants';

/**
 * Default dev server ports by framework.
 */
const DEFAULT_PORTS: Record<Integration, number> = {
  nextjs: 3000,
  react: 5173,
  'tanstack-start': 3000,
  'react-router': 5173,
  'vanilla-js': 5173,
};

/**
 * Default callback paths per SDK convention.
 * These match what each AuthKit SDK creates by default.
 */
const DEFAULT_CALLBACK_PATHS: Record<Integration, string> = {
  nextjs: '/api/auth/callback',
  react: '/callback',
  'tanstack-start': '/api/auth/callback',
  'react-router': '/callback',
  'vanilla-js': '/callback',
};

/**
 * Get the callback path for a framework's AuthKit SDK.
 */
export function getCallbackPath(integration: Integration): string {
  return DEFAULT_CALLBACK_PATHS[integration];
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
  const configPaths = [
    join(installDir, 'app.config.ts'),
    join(installDir, 'app.config.js'),
  ];

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
 * Detect the dev server port for a framework.
 * Checks config files first, falls back to framework default.
 */
export function detectPort(
  integration: Integration,
  installDir: string,
): number {
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
  }

  return detectedPort ?? DEFAULT_PORTS[integration];
}

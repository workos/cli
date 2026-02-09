import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FrameworkConfig } from './framework-config.js';
import type { Language } from './language-detection.js';
import type { InstallerOptions } from '../utils/types.js';

/**
 * Standard exports from an integration module.
 * Each `src/integrations/{name}/index.ts` must export these.
 */
export interface IntegrationModule {
  config: FrameworkConfig;
  run: (options: InstallerOptions) => Promise<string>;
}

/**
 * Registry that provides lookup, detection, and enumeration of integrations.
 */
export interface IntegrationRegistry {
  /** All registered integrations */
  all(): FrameworkConfig[];

  /** Get config by integration name */
  get(name: string): IntegrationModule | undefined;

  /** Get integrations for a specific language, ordered by priority */
  forLanguage(language: Language): FrameworkConfig[];

  /** Get integration names for CLI choices */
  choices(): Array<{ name: string; value: string }>;

  /** Detection order: all integrations sorted by priority (higher = checked first) */
  detectionOrder(): FrameworkConfig[];
}

/**
 * Build the integration registry by discovering all integration modules.
 * Scans `src/integrations/` (or `dist/integrations/` at runtime) for directories
 * with an index.js/index.ts file and dynamically imports them.
 */
export async function buildRegistry(): Promise<IntegrationRegistry> {
  const modules = new Map<string, IntegrationModule>();

  // Resolve the integrations directory relative to this file
  // In dev: src/lib/registry.ts -> src/integrations/
  // In dist: dist/lib/registry.js -> dist/integrations/
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const integrationsDir = join(__dirname, '..', 'integrations');

  if (!existsSync(integrationsDir)) {
    throw new Error(
      `No integrations directory found at ${integrationsDir}. Is the build corrupt?`,
    );
  }

  const entries = readdirSync(integrationsDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  if (dirs.length === 0) {
    throw new Error(
      'No integrations found. Is the build corrupt?',
    );
  }

  for (const dir of dirs) {
    // Skip directories starting with _ (convention for internal files like _manifest.ts)
    if (dir.startsWith('_')) continue;

    const indexPath = join(integrationsDir, dir, 'index.js');
    const indexTsPath = join(integrationsDir, dir, 'index.ts');

    if (!existsSync(indexPath) && !existsSync(indexTsPath)) {
      // Skip directories without an index file (not an integration)
      continue;
    }

    try {
      const mod = (await import(join(integrationsDir, dir, 'index.js'))) as IntegrationModule;

      if (!mod.config || !mod.run) {
        console.warn(`Integration ${dir} missing 'config' or 'run' export, skipping`);
        continue;
      }

      const name = mod.config.metadata.integration;

      if (modules.has(name)) {
        throw new Error(
          `Duplicate integration name: '${name}' (found in both existing and '${dir}/')`,
        );
      }

      modules.set(name, mod);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Duplicate integration name')) {
        throw err; // Re-throw duplicate name errors
      }
      console.warn(`Failed to load integration from ${dir}/: ${err}`);
    }
  }

  // Build sorted config array (by priority, descending)
  const sortedConfigs = Array.from(modules.values())
    .map((m) => m.config)
    .sort((a, b) => b.metadata.priority - a.metadata.priority);

  return {
    all() {
      return sortedConfigs;
    },

    get(name: string) {
      return modules.get(name);
    },

    forLanguage(language: Language) {
      return sortedConfigs.filter((c) => c.metadata.language === language);
    },

    choices() {
      return sortedConfigs.map((c) => ({
        name: c.metadata.name,
        value: c.metadata.integration,
      }));
    },

    detectionOrder() {
      return sortedConfigs;
    },
  };
}

// Singleton cache
let _registry: IntegrationRegistry | null = null;

/**
 * Get the integration registry (builds once, caches thereafter).
 */
export async function getRegistry(): Promise<IntegrationRegistry> {
  if (!_registry) {
    _registry = await buildRegistry();
  }
  return _registry;
}

/**
 * Reset the registry cache. Used in tests.
 */
export function resetRegistry(): void {
  _registry = null;
}

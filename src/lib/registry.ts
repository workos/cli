import type { FrameworkConfig, Language } from './framework-config.js';
import type { InstallerOptions } from '../utils/types.js';
import { integrationModules } from '../integrations/_manifest.js';

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
 * Build the integration registry from the generated static manifest.
 * Static imports allow Bun to include every integration in a compiled binary.
 */
export async function buildRegistry(): Promise<IntegrationRegistry> {
  const modules = new Map<string, IntegrationModule>();

  const entries = Object.entries(integrationModules);
  if (entries.length === 0) {
    throw new Error('No integrations found. Is the build corrupt?');
  }

  for (const [dir, mod] of entries) {
    if (!mod.config || !mod.run) {
      console.warn(`Integration ${dir} missing 'config' or 'run' export, skipping`);
      continue;
    }

    const name = mod.config.metadata.integration;
    if (modules.has(name)) {
      throw new Error(`Duplicate integration name: '${name}' (found in both existing and '${dir}/')`);
    }

    modules.set(name, mod);
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

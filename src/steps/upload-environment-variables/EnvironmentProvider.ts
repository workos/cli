import type { InstallerOptions } from '../../utils/types.js';

export abstract class EnvironmentProvider {
  protected options: InstallerOptions;

  abstract name: string;

  constructor(options: InstallerOptions) {
    this.options = options;
  }

  abstract detect(): Promise<boolean>;

  abstract uploadEnvVars(vars: Record<string, string>): Promise<Record<string, boolean>>;

  /** Check for existing env vars in the provider. Returns var names, or empty on failure. */
  async checkExistingVars(): Promise<string[]> {
    return [];
  }
}

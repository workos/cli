// Legacy types - unused in WorkOS wizard
export type LegacyProjectData = Record<string, unknown>;

export type PreselectedProject = {
  project: LegacyProjectData;
  authToken: string;
};

export type WizardOptions = {
  /**
   * Whether to enable debug mode.
   */
  debug: boolean;

  /**
   * Whether to force install the SDK package to continue with the installation in case
   * any package manager checks are failing (e.g. peer dependency versions).
   *
   * Use with caution and only if you know what you're doing.
   *
   * Does not apply to all wizard flows (currently NPM only)
   */
  forceInstall: boolean;

  /**
   * The directory to run the wizard in.
   */
  installDir: string;

  /**
   * Whether to select the default option for all questions automatically.
   */
  default: boolean;

  /**
   * Whether to use local services (LLM gateway on localhost:8000)
   */
  local: boolean;

  /**
   * CI mode - non-interactive execution
   */
  ci: boolean;

  /**
   * Skip authentication check (for local development only)
   */
  skipAuth: boolean;

  /**
   * WorkOS API key (sk_xxx)
   */
  apiKey?: string;

  /**
   * WorkOS Client ID (client_xxx)
   */
  clientId?: string;

  /**
   * App homepage URL for WorkOS dashboard config.
   * Defaults to http://localhost:{detected_port}
   */
  homepageUrl?: string;

  /**
   * Redirect URI for WorkOS callback.
   * Defaults to framework-specific convention (e.g., /api/auth/callback)
   */
  redirectUri?: string;

  /**
   * [Experimental] Enable visual dashboard mode
   */
  dashboard?: boolean;

  /**
   * Event emitter for dashboard mode
   */
  emitter?: import('../lib/events.js').WizardEventEmitter;
};

export interface Feature {
  id: string;
  prompt: string;
  enabledHint?: string;
  disabledHint?: string;
}

export type FileChange = {
  filePath: string;
  oldContent?: string;
  newContent: string;
};

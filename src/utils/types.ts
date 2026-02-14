export type InstallerOptions = {
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
  emitter?: import('../lib/events.js').InstallerEventEmitter;

  /**
   * Pre-selected framework integration (bypasses detection)
   */
  integration?: import('../lib/constants.js').Integration;

  /**
   * Enable XState inspector - opens browser to visualize state machine live
   */
  inspect?: boolean;

  /**
   * Skip post-installation validation (includes build check)
   */
  noValidate?: boolean;

  /**
   * Skip post-install commit and PR workflow
   */
  noCommit?: boolean;

  /**
   * Direct mode - bypass llm-gateway and use user's own Anthropic API key.
   * Requires ANTHROPIC_API_KEY environment variable.
   */
  direct?: boolean;

  /**
   * Max correction attempts after initial agent run.
   * The agent gets this many chances to fix validation failures (typecheck/build).
   * Default: 2. Set to 0 to disable retries entirely.
   */
  maxRetries?: number;
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

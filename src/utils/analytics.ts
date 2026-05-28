import os from 'node:os';
import { basename } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { debug } from './debug.js';
import { telemetryClient } from './telemetry-client.js';
import type {
  AuthMode,
  SessionStartEvent,
  SessionEndEvent,
  StepEvent,
  AgentToolEvent,
  AgentLLMEvent,
  CommandEvent,
  CrashEvent,
  TerminationReason,
} from './telemetry-types.js';
import { WORKOS_TELEMETRY_ENABLED } from '../lib/constants.js';
import { getLlmGatewayUrl, getVersion } from '../lib/settings.js';
import { getCredentials } from '../lib/credentials.js';
import { getActiveEnvironment, isUnclaimedEnvironment } from '../lib/config-store.js';
import { getDeviceId } from '../lib/device-id.js';
import { sanitizeMessage, sanitizeStack } from './crash-reporter.js';

export class Analytics {
  private tags: Record<string, string | boolean | number | null | undefined> = {};
  private sessionId: string;
  private sessionStartTime: Date;
  private distinctId?: string;
  private mode?: 'cli' | 'tui' | 'headless';
  private authMode: AuthMode = 'none';

  // Agent metrics tracking
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private agentIterations = 0;

  constructor() {
    this.sessionId = uuidv4();
    this.sessionStartTime = new Date();
    this.tags = { $app_name: 'authkit-installer' };
  }

  setDistinctId(distinctId: string) {
    this.distinctId = distinctId;
  }

  setAccessToken(token: string) {
    telemetryClient.setAccessToken(token);
  }

  /**
   * Set the auth mode explicitly. Used by installer flows where credential
   * resolution happens outside `initForNonInstaller` (see run-with-core.ts).
   */
  setAuthMode(mode: AuthMode) {
    this.authMode = mode;
  }

  setGatewayUrl(url: string) {
    telemetryClient.setGatewayUrl(url);
  }

  /**
   * Initialize telemetry for non-installer commands.
   * Sets gatewayUrl from default config and loads auth credentials.
   *
   * Auth priority:
   *   1. Stored JWT (Bearer) — logged-in users
   *   2. Claim token — unclaimed environments
   *   3. None — API-key-only users (telemetry silently dropped by API guard)
   *
   * Also captures the user/environment identifier for per-user analytics.
   * The installer flow sets these itself in run-with-core.ts; this covers
   * management commands like `org list`, `auth login`, etc.
   */
  initForNonInstaller(): void {
    if (!WORKOS_TELEMETRY_ENABLED) return;

    const gatewayUrl = getLlmGatewayUrl();
    telemetryClient.setGatewayUrl(gatewayUrl);

    const creds = getCredentials();
    if (creds?.accessToken) {
      telemetryClient.setAccessToken(creds.accessToken);
      this.authMode = 'jwt';
    }
    if (creds?.userId) {
      this.distinctId = creds.userId;
    }

    // Check for unclaimed environment — fall back to claim-token auth
    // so unclaimed users' telemetry still reaches the backend.
    try {
      const env = getActiveEnvironment();
      if (env && isUnclaimedEnvironment(env)) {
        telemetryClient.setClaimTokenAuth(env.clientId, env.claimToken);
        // Tag distinctId so unclaimed sessions are identifiable in analytics
        this.distinctId = this.distinctId ?? `unclaimed:${env.clientId}`;
        if (this.authMode === 'none') this.authMode = 'claim_token';
      }
    } catch {
      // Config-store failure is non-fatal for telemetry
    }

    // WORKOS_API_KEY covers API-key-only users. Lowest priority — JWT and
    // claim-token paths actually deliver telemetry, while api_key is silently
    // dropped by the gateway guard; tagging it correctly still matters for
    // cohort analysis.
    if (this.authMode === 'none' && process.env.WORKOS_API_KEY) {
      this.authMode = 'api_key';
    }
  }

  setTag(key: string, value: string | boolean | number | null | undefined) {
    this.tags[key] = value;
  }

  capture(eventName: string, properties?: Record<string, unknown>) {
    if (!WORKOS_TELEMETRY_ENABLED) return;

    debug(`[Analytics] capture: ${eventName}`, properties);

    // Accumulate primitive values as tags for the session.end event
    if (properties) {
      for (const [key, value] of Object.entries(properties)) {
        if (['string', 'number', 'boolean'].includes(typeof value)) {
          this.tags[key] = value as string | number | boolean;
        }
      }
    }
  }

  captureException(error: Error, properties: Record<string, unknown> = {}) {
    if (!WORKOS_TELEMETRY_ENABLED) return;

    debug('[Analytics] captureException:', error.message, properties);
    const { type, message } = this.extractErrorFields(error);
    this.tags['error.type'] = type;
    this.tags['error.message'] = message;
  }

  async getFeatureFlag(_flagKey: string): Promise<string | boolean | undefined> {
    // Feature flags not implemented yet
    return undefined;
  }

  /** All capture methods that record error details MUST go through this. */
  private extractErrorFields(error: Error): { type: string; message: string } {
    return {
      type: error.name,
      message: sanitizeMessage(error.message),
    };
  }

  private detectCiProvider(): string | undefined {
    if (process.env.GITHUB_ACTIONS) return 'github-actions';
    if (process.env.BUILDKITE) return 'buildkite';
    if (process.env.CIRCLECI) return 'circleci';
    if (process.env.GITLAB_CI) return 'gitlab-ci';
    if (process.env.JENKINS_URL) return 'jenkins';
    return undefined;
  }

  private getEnvFingerprint() {
    let osVersion: string;
    try {
      osVersion = os.release();
    } catch {
      osVersion = 'unknown';
    }

    const ciProvider = this.detectCiProvider();

    return {
      'device.id': getDeviceId(),
      'auth.mode': this.authMode,
      'env.os': process.platform,
      'env.os_version': osVersion,
      'env.node_version': process.version,
      'env.shell': basename(process.env.SHELL ?? process.env.COMSPEC ?? 'unknown'),
      'env.ci': Boolean(process.env.CI || process.env.GITHUB_ACTIONS || process.env.BUILDKITE),
      ...(ciProvider ? { 'env.ci_provider': ciProvider } : {}),
    };
  }

  sessionStart(mode: 'cli' | 'tui' | 'headless', version: string) {
    if (!WORKOS_TELEMETRY_ENABLED) return;

    this.mode = mode;

    const event: SessionStartEvent = {
      type: 'session.start',
      sessionId: this.sessionId,
      timestamp: this.sessionStartTime.toISOString(),
      attributes: {
        'installer.version': version,
        'installer.mode': mode,
        'workos.user_id': this.distinctId,
        ...this.getEnvFingerprint(),
      },
    };

    telemetryClient.queueEvent(event);
  }

  stepCompleted(name: string, durationMs: number, success: boolean, error?: Error) {
    if (!WORKOS_TELEMETRY_ENABLED) return;

    const event: StepEvent = {
      type: 'step',
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      name,
      startTimestamp: new Date(Date.now() - durationMs).toISOString(),
      durationMs,
      success,
      error: error ? this.extractErrorFields(error) : undefined,
    };

    telemetryClient.queueEvent(event);
  }

  toolCalled(toolName: string, durationMs: number, success: boolean) {
    if (!WORKOS_TELEMETRY_ENABLED) return;

    const event: AgentToolEvent = {
      type: 'agent.tool',
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      toolName,
      startTimestamp: new Date(Date.now() - durationMs).toISOString(),
      durationMs,
      success,
    };

    telemetryClient.queueEvent(event);
  }

  llmRequest(model: string, inputTokens: number, outputTokens: number) {
    if (!WORKOS_TELEMETRY_ENABLED) return;

    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;

    const event: AgentLLMEvent = {
      type: 'agent.llm',
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      model,
      inputTokens,
      outputTokens,
    };

    telemetryClient.queueEvent(event);
  }

  incrementAgentIterations() {
    this.agentIterations++;
  }

  emitCommandEvent(
    name: string,
    durationMs: number,
    success: boolean,
    options?: {
      error?: Error;
      flags?: string[];
      reason?: TerminationReason;
      errorCode?: string;
      apiContext?: { status?: number; code?: string; resource?: string };
    },
  ) {
    if (!WORKOS_TELEMETRY_ENABLED) return;

    const errorFields = options?.error ? this.extractErrorFields(options.error) : undefined;

    const event: CommandEvent = {
      type: 'command',
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      attributes: {
        'command.name': name,
        'command.duration_ms': durationMs,
        'command.success': success,
        'cli.version': getVersion(),
        ...(this.distinctId ? { 'workos.user_id': this.distinctId } : {}),
        ...(errorFields
          ? {
              'command.error_type': errorFields.type,
              'command.error_message': errorFields.message,
            }
          : {}),
        ...(options?.flags?.length ? { 'command.flags': options.flags.join(',') } : {}),
        ...(options?.reason ? { 'termination.reason': options.reason } : {}),
        ...(options?.errorCode ? { 'error.code': options.errorCode } : {}),
        ...(options?.apiContext?.status !== undefined ? { 'api.status': options.apiContext.status } : {}),
        ...(options?.apiContext?.code ? { 'api.code': options.apiContext.code } : {}),
        ...(options?.apiContext?.resource ? { 'api.resource': options.apiContext.resource } : {}),
        ...this.getEnvFingerprint(),
      },
    };

    telemetryClient.queueEvent(event);
  }

  captureUnhandledCrash(error: Error, options?: { command?: string; version?: string }) {
    if (!WORKOS_TELEMETRY_ENABLED) return;

    const { type, message } = this.extractErrorFields(error);

    const event: CrashEvent = {
      type: 'crash',
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      attributes: {
        'crash.error_type': type,
        'crash.error_message': message,
        'crash.stack': sanitizeStack(error.stack),
        ...(options?.command ? { 'crash.command': options.command } : {}),
        'cli.version': options?.version ?? getVersion(),
        ...(this.distinctId ? { 'workos.user_id': this.distinctId } : {}),
        ...this.getEnvFingerprint(),
      },
    };

    telemetryClient.queueEvent(event);
  }

  async shutdown(status: 'success' | 'error' | 'cancelled') {
    if (!WORKOS_TELEMETRY_ENABLED) return;

    const duration = Date.now() - this.sessionStartTime.getTime();

    // Filter out null/undefined tags
    const extraAttributes = Object.fromEntries(Object.entries(this.tags).filter(([, v]) => v != null)) as Record<
      string,
      string | number | boolean
    >;

    const envFingerprint = this.getEnvFingerprint();

    const event: SessionEndEvent = {
      type: 'session.end',
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      attributes: {
        'installer.outcome': status,
        'installer.duration_ms': duration,
        'installer.agent.iterations': this.agentIterations,
        'installer.agent.tokens.input': this.totalInputTokens,
        'installer.agent.tokens.output': this.totalOutputTokens,
        ...envFingerprint,
        ...(this.mode ? { 'installer.mode': this.mode } : {}),
        ...extraAttributes,
      },
    };

    telemetryClient.queueEvent(event);
    await telemetryClient.flush();
  }
}

export const analytics = new Analytics();

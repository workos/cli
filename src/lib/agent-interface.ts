/**
 * Shared agent interface for WorkOS wizards
 * Uses Claude Agent SDK directly with WorkOS MCP server
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { debug, logInfo, logWarn, logError, initLogFile, getLogFilePath } from '../utils/debug.js';
import type { InstallerOptions } from '../utils/types.js';
import { analytics } from '../utils/analytics.js';
import { WIZARD_INTERACTION_EVENT_NAME } from './constants.js';
import { LINTING_TOOLS } from './safe-tools.js';
import { getLlmGatewayUrlFromHost } from '../utils/urls.js';
import { getConfig } from './settings.js';
import { getCredentials, hasCredentials } from './credentials.js';
import { ensureValidToken } from './token-refresh.js';
import type { InstallerEventEmitter } from './events.js';
import { startCredentialProxy, type CredentialProxyHandle } from './credential-proxy.js';
import { getAuthkitDomain, getCliAuthClientId } from './settings.js';

// File content cache for computing edit diffs
const fileContentCache = new Map<string, string>();
// Track pending Read operations by tool_use_id
const pendingReads = new Map<string, string>();
// Track tool start times by tool_use_id for telemetry
const pendingToolCalls = new Map<string, { toolName: string; startTime: number }>();

// Module-level variable to track proxy handle for cleanup
let activeProxyHandle: CredentialProxyHandle | null = null;

// Dynamic import cache for ESM module
let _sdkModule: any = null;
async function getSDKModule(): Promise<any> {
  if (!_sdkModule) {
    _sdkModule = await import('@anthropic-ai/claude-agent-sdk');
  }
  return _sdkModule;
}

// Using `any` because typed imports from ESM modules require import attributes
// syntax which prettier cannot parse. See PR discussion for details.
type SDKMessage = any;
type McpServersConfig = any;

export const AgentSignals = {
  /** Signal emitted when the agent reports progress to the user */
  STATUS: '[STATUS]',
  /** Signal emitted when the agent cannot access the WorkOS MCP server */
  ERROR_MCP_MISSING: '[ERROR-MCP-MISSING]',
  /** Signal emitted when the agent cannot access the setup resource */
  ERROR_RESOURCE_MISSING: '[ERROR-RESOURCE-MISSING]',
} as const;

export type AgentSignal = (typeof AgentSignals)[keyof typeof AgentSignals];

/**
 * Error types that can be returned from agent execution.
 * These correspond to the error signals that the agent emits.
 */
export enum AgentErrorType {
  /** Agent could not access the WorkOS MCP server */
  MCP_MISSING = 'WIZARD_MCP_MISSING',
  /** Agent could not access the setup resource */
  RESOURCE_MISSING = 'WIZARD_RESOURCE_MISSING',
  /** Agent execution failed (API error, auth error, etc.) */
  EXECUTION_ERROR = 'WIZARD_EXECUTION_ERROR',
}

export type AgentConfig = {
  workingDirectory: string;
  workOSApiKey: string;
  workOSApiHost: string;
};

/**
 * Internal configuration object returned by initializeAgent
 */
type AgentRunConfig = {
  workingDirectory: string;
  mcpServers: McpServersConfig;
  model: string;
  allowedTools: string[];
  sdkEnv: Record<string, string | undefined>;
};

/**
 * Package managers that can be used to run commands.
 */
const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun', 'npx'];

/**
 * Safe scripts/commands that can be run with any package manager.
 * Uses startsWith matching, so 'build' matches 'build', 'build:prod', etc.
 * Note: Linting tools are in LINTING_TOOLS and checked separately.
 */
const SAFE_SCRIPTS = [
  // Package installation
  'install',
  'add',
  'ci',
  // Build
  'build',
  // Type checking (various naming conventions)
  'tsc',
  'typecheck',
  'type-check',
  'check-types',
  'types',
  // Linting/formatting script names (actual tools are in LINTING_TOOLS)
  'lint',
  'format',
];

/**
 * Dangerous shell operators that could allow command injection.
 * Note: We handle `2>&1` and `| tail/head` separately as safe patterns.
 */
const DANGEROUS_OPERATORS = /[;`$()]/;

/**
 * Check if command is an allowed package manager command.
 * Matches: <pkg-manager> [run|exec] <safe-script> [args...]
 */
function matchesAllowedPrefix(command: string): boolean {
  const parts = command.split(/\s+/);
  if (parts.length === 0 || !PACKAGE_MANAGERS.includes(parts[0])) {
    return false;
  }

  // Skip 'run' or 'exec' if present
  let scriptIndex = 1;
  if (parts[scriptIndex] === 'run' || parts[scriptIndex] === 'exec') {
    scriptIndex++;
  }

  // Get the script/command portion (may include args)
  const scriptPart = parts.slice(scriptIndex).join(' ');

  // Check if script starts with any safe script name or linting tool
  return (
    SAFE_SCRIPTS.some((safe) => scriptPart.startsWith(safe)) ||
    LINTING_TOOLS.some((tool) => scriptPart.startsWith(tool))
  );
}

/**
 * Permission hook that allows only safe commands.
 * - Package manager install commands
 * - Build/typecheck/lint commands for verification
 * - Piping to tail/head for output limiting is allowed
 * - Stderr redirection (2>&1) is allowed
 */
export function wizardCanUseTool(
  toolName: string,
  input: Record<string, unknown>,
): { behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string } {
  // Allow all non-Bash tools
  if (toolName !== 'Bash') {
    return { behavior: 'allow', updatedInput: input };
  }

  const command = (typeof input.command === 'string' ? input.command : '').trim();

  // Block definitely dangerous operators: ; ` $ ( )
  if (DANGEROUS_OPERATORS.test(command)) {
    logWarn(`Denying bash command with dangerous operators: ${command}`);
    debug(`Denying bash command with dangerous operators: ${command}`);
    analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
      action: 'bash command denied',
      reason: 'dangerous operators',
      command,
    });
    return {
      behavior: 'deny',
      message: `Bash command not allowed. Shell operators like ; \` $ ( ) are not permitted.`,
    };
  }

  // Normalize: remove safe stderr redirection (2>&1, 2>&2, etc.)
  const normalized = command.replace(/\s*\d*>&\d+\s*/g, ' ').trim();

  // Check for pipe to tail/head (safe output limiting)
  const pipeMatch = normalized.match(/^(.+?)\s*\|\s*(tail|head)(\s+\S+)*\s*$/);
  if (pipeMatch) {
    const baseCommand = pipeMatch[1].trim();

    // Block if base command has pipes or & (multiple chaining)
    if (/[|&]/.test(baseCommand)) {
      logWarn(`Denying bash command with multiple pipes: ${command}`);
      debug(`Denying bash command with multiple pipes: ${command}`);
      analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
        action: 'bash command denied',
        reason: 'multiple pipes',
        command,
      });
      return {
        behavior: 'deny',
        message: `Bash command not allowed. Only single pipe to tail/head is permitted.`,
      };
    }

    if (matchesAllowedPrefix(baseCommand)) {
      logInfo(`Allowing bash command with output limiter: ${command}`);
      debug(`Allowing bash command with output limiter: ${command}`);
      return { behavior: 'allow', updatedInput: input };
    }
  }

  // Block remaining pipes and & (not covered by tail/head case above)
  if (/[|&]/.test(normalized)) {
    logWarn(`Denying bash command with pipe/&: ${command}`);
    debug(`Denying bash command with pipe/&: ${command}`);
    analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
      action: 'bash command denied',
      reason: 'disallowed pipe',
      command,
    });
    return {
      behavior: 'deny',
      message: `Bash command not allowed. Pipes are only permitted with tail/head for output limiting.`,
    };
  }

  // Check if command starts with any allowed prefix
  if (matchesAllowedPrefix(normalized)) {
    logInfo(`Allowing bash command: ${command}`);
    debug(`Allowing bash command: ${command}`);
    return { behavior: 'allow', updatedInput: input };
  }

  logWarn(`Denying bash command: ${command}`);
  debug(`Denying bash command: ${command}`);
  analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
    action: 'bash command denied',
    reason: 'not in allowlist',
    command,
  });
  return {
    behavior: 'deny',
    message: `Bash command not allowed. Only install, build, typecheck, lint, and formatting commands are permitted.`,
  };
}

/**
 * Initialize agent configuration for the LLM gateway
 */
export async function initializeAgent(config: AgentConfig, options: InstallerOptions): Promise<AgentRunConfig> {
  // Initialize log file for this run
  initLogFile();
  logInfo('Agent initialization starting');
  logInfo('Install directory:', options.installDir);

  // Emit status event for adapters to render
  options.emitter?.emit('status', { message: 'Initializing Claude agent...' });

  try {
    let authMode: string;
    // Build SDK env without mutating process.env
    const sdkEnv: Record<string, string | undefined> = {
      ...process.env,
      // Disable experimental betas (like input_examples) that the LLM gateway doesn't support
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: 'true',
      // Disable SDK telemetry - our gateway doesn't proxy /api/event_logging/batch
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'true',
    };

    if (options.direct) {
      // Direct mode: use user's Anthropic API key, skip gateway
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error(
          'Direct mode requires ANTHROPIC_API_KEY environment variable.\n' +
            'Set it with: export ANTHROPIC_API_KEY=sk-ant-...\n' +
            'Get your key at: https://console.anthropic.com/settings/keys',
        );
      }

      // SDK defaults to api.anthropic.com when no base URL set
      delete sdkEnv.ANTHROPIC_BASE_URL;
      delete sdkEnv.ANTHROPIC_AUTH_TOKEN;
      authMode = 'direct:api.anthropic.com';
      logInfo('Direct mode: using ANTHROPIC_API_KEY, bypassing llm-gateway');

      // Set analytics tag for direct mode
      analytics.setTag('api_mode', 'direct');
    } else {
      // Gateway mode (existing behavior)
      const gatewayUrl = getLlmGatewayUrlFromHost();

      // Check/refresh authentication for production (unless skipping auth)
      if (!options.skipAuth && !options.local) {
        if (!hasCredentials()) {
          throw new Error('Not authenticated. Run `wizard login` to authenticate.');
        }

        const creds = getCredentials();
        if (!creds) {
          throw new Error('Not authenticated. Run `wizard login` to authenticate.');
        }

        // Check if we have refresh token capability and proxy is not disabled
        if (creds.refreshToken && process.env.WIZARD_DISABLE_PROXY !== '1') {
          // Start credential proxy with lazy refresh
          logInfo('[agent-interface] Starting credential proxy with lazy refresh...');
          const appConfig = getConfig();

          activeProxyHandle = await startCredentialProxy({
            upstreamUrl: gatewayUrl,
            refresh: {
              authkitDomain: getAuthkitDomain(),
              clientId: getCliAuthClientId(),
              refreshThresholdMs: appConfig.proxy.refreshThresholdMs,
              onRefreshSuccess: () => {
                options.emitter?.emit('status', { message: 'Session extended' });
              },
              onRefreshExpired: () => {
                logError('[agent-interface] Session expired, refresh token invalid');
                options.emitter?.emit('error', {
                  message: 'Session expired. Run `wizard login` to re-authenticate.',
                });
              },
            },
          });

          // Point SDK at proxy instead of direct gateway
          sdkEnv.ANTHROPIC_BASE_URL = activeProxyHandle.url;
          logInfo(`[agent-interface] Using credential proxy at ${activeProxyHandle.url}`);

          // Proxy handles auth, so we don't set ANTHROPIC_AUTH_TOKEN
          delete sdkEnv.ANTHROPIC_AUTH_TOKEN;
          authMode = `proxy:${activeProxyHandle.url}→${gatewayUrl}`;
        } else {
          // No refresh token OR proxy disabled - fall back to old behavior (5 min limit)
          if (!creds.refreshToken) {
            logWarn('[agent-interface] No refresh token available, session limited to 5 minutes');
            logWarn('[agent-interface] Run `wizard login` to enable extended sessions');
            options.emitter?.emit('status', {
              message: 'Note: Run `wizard login` to enable extended sessions',
            });
          } else {
            logWarn('[agent-interface] Proxy disabled via WIZARD_DISABLE_PROXY');
          }

          const refreshResult = await ensureValidToken();
          if (!refreshResult.success) {
            throw new Error(refreshResult.error || 'Authentication failed');
          }

          sdkEnv.ANTHROPIC_BASE_URL = gatewayUrl;
          sdkEnv.ANTHROPIC_AUTH_TOKEN = creds.accessToken;
          authMode = options.local ? `local-gateway:${gatewayUrl}` : `workos-gateway:${gatewayUrl}`;
          logInfo('Sending access token to gateway (legacy mode)');
        }
      } else if (options.skipAuth) {
        // Skip auth mode - direct to gateway without auth
        sdkEnv.ANTHROPIC_BASE_URL = gatewayUrl;
        delete sdkEnv.ANTHROPIC_AUTH_TOKEN;
        authMode = `skip-auth:${gatewayUrl}`;
        logInfo('Skipping auth - no token sent to gateway');
      } else {
        // Local mode without auth
        sdkEnv.ANTHROPIC_BASE_URL = gatewayUrl;
        delete sdkEnv.ANTHROPIC_AUTH_TOKEN;
        authMode = `local-gateway:${gatewayUrl}`;
        logInfo('Local mode - no token sent to gateway');
      }

      logInfo('Configured LLM gateway:', sdkEnv.ANTHROPIC_BASE_URL);

      // Set analytics tag for gateway mode
      analytics.setTag('api_mode', activeProxyHandle ? 'gateway-proxy' : 'gateway');
    }

    // Configure WorkOS MCP docs server for accessing WorkOS documentation
    const agentRunConfig: AgentRunConfig = {
      workingDirectory: config.workingDirectory,
      mcpServers: {
        workos: {
          command: 'npx',
          args: ['-y', '@workos/mcp-docs-server'],
        },
      },
      model: getConfig().model,
      allowedTools: ['Skill', 'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch'],
      sdkEnv,
    };

    const configInfo = { workingDirectory: agentRunConfig.workingDirectory, authMode, useMcp: false };
    logInfo('Agent config:', configInfo);
    debug('Agent config:', configInfo);

    // Emit status events for adapters to render
    const currentLogPath = getLogFilePath();
    if (currentLogPath) {
      options.emitter?.emit('status', { message: `Verbose logs: ${currentLogPath}` });
    }
    options.emitter?.emit('status', { message: "Agent initialized. Let's get cooking!" });

    return agentRunConfig;
  } catch (error) {
    // Clean up proxy if initialization fails
    if (activeProxyHandle) {
      logInfo('[agent-interface] Cleaning up proxy after init error');
      await activeProxyHandle.stop();
      activeProxyHandle = null;
    }
    logError('Agent initialization error:', error);
    throw error;
  }
}

/**
 * Execute an agent with the provided prompt and options
 * Handles the full lifecycle via event emissions - adapters handle UI rendering.
 *
 * @returns An object containing any error detected in the agent's output
 */
export async function runAgent(
  agentConfig: AgentRunConfig,
  prompt: string,
  options: InstallerOptions,
  config?: {
    spinnerMessage?: string;
    successMessage?: string;
    errorMessage?: string;
  },
  emitter?: InstallerEventEmitter,
): Promise<{ error?: AgentErrorType; errorMessage?: string }> {
  const {
    spinnerMessage = 'Setting up WorkOS AuthKit...',
    successMessage = 'WorkOS AuthKit integration complete',
    errorMessage = 'Integration failed',
  } = config ?? {};

  const { query } = await getSDKModule();

  // Emit progress for adapters to handle (e.g., CLI adapter starts spinner)
  emitter?.emit('agent:progress', { step: 'Starting', detail: 'This may take a few minutes. Grab some coffee!' });
  emitter?.emit('agent:progress', { step: spinnerMessage });

  logInfo('Starting agent run');
  logInfo('Prompt:', prompt);

  const startTime = Date.now();
  const collectedText: string[] = [];

  try {
    // Workaround for SDK bug: stdin closes before canUseTool responses can be sent.
    // The fix is to use an async generator for the prompt that stays open until
    // the result is received, keeping the stdin stream alive for permission responses.
    // See: https://github.com/anthropics/claude-code/issues/4775
    // See: https://github.com/anthropics/claude-agent-sdk-typescript/issues/41
    let signalDone: () => void;
    const resultReceived = new Promise<void>((resolve) => {
      signalDone = resolve;
    });

    const createPromptStream = async function* () {
      yield {
        type: 'user',
        session_id: '',
        message: { role: 'user', content: prompt },
        parent_tool_use_id: null,
      };
      await resultReceived;
    };

    // Load plugin with bundled skills
    // Path from dist/src/lib/ back to package root
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const pluginPath = path.join(__dirname, '../../..');
    logInfo('Loading plugin from:', pluginPath);

    const response = query({
      prompt: createPromptStream(),
      options: {
        model: agentConfig.model,
        cwd: agentConfig.workingDirectory,
        permissionMode: 'acceptEdits',
        mcpServers: agentConfig.mcpServers,
        env: agentConfig.sdkEnv,
        canUseTool: (toolName: string, input: unknown) => {
          logInfo('canUseTool called:', { toolName, input });
          const result = wizardCanUseTool(toolName, input as Record<string, unknown>);
          logInfo('canUseTool result:', result);
          return Promise.resolve(result);
        },
        tools: { type: 'preset', preset: 'claude_code' },
        allowedTools: agentConfig.allowedTools,
        plugins: [{ type: 'local', path: pluginPath }],
        // Capture stderr from CLI subprocess for debugging
        stderr: (data: string) => {
          logInfo('CLI stderr:', data);
          if (options.debug) {
            debug('CLI stderr:', data);
          }
        },
      },
    });

    // Process the async generator
    let sdkError: string | undefined;
    for await (const message of response) {
      const messageError = handleSDKMessage(message, options, collectedText, emitter);
      if (messageError) {
        sdkError = messageError;
      }
      // Signal completion when result received
      if (message.type === 'result') {
        signalDone!();
      }
    }

    const durationMs = Date.now() - startTime;
    const outputText = collectedText.join('\n');

    // Check for SDK errors first (e.g., API errors, auth failures)
    // Return error type + message - caller decides whether to throw or emit events
    if (sdkError) {
      logError('Agent SDK error:', sdkError);
      return { error: AgentErrorType.EXECUTION_ERROR, errorMessage: sdkError };
    }

    // Check for error markers in the agent's output
    if (outputText.includes(AgentSignals.ERROR_MCP_MISSING)) {
      logError('Agent error: MCP_MISSING');
      return { error: AgentErrorType.MCP_MISSING, errorMessage: 'Could not access WorkOS MCP server' };
    }

    if (outputText.includes(AgentSignals.ERROR_RESOURCE_MISSING)) {
      logError('Agent error: RESOURCE_MISSING');
      return { error: AgentErrorType.RESOURCE_MISSING, errorMessage: 'Could not access setup resource' };
    }

    logInfo(`Agent run completed in ${Math.round(durationMs / 1000)}s`);
    analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
      action: 'agent integration completed',
      duration_ms: durationMs,
      duration_seconds: Math.round(durationMs / 1000),
    });

    // Don't emit agent:success here - let the state machine handle lifecycle events
    return {};
  } catch (error) {
    // Don't emit events here - just log and re-throw for state machine to handle
    logError('Agent run failed:', error);
    debug('Full error:', error);
    throw error;
  } finally {
    // Always clean up proxy when agent run completes
    if (activeProxyHandle) {
      logInfo('[agent-interface] Stopping credential proxy');

      analytics.capture('wizard.proxy', {
        action: 'stop',
        port: activeProxyHandle.port,
      });

      await activeProxyHandle.stop();
      activeProxyHandle = null;
    }
  }
}

/**
 * Handle SDK messages and emit events for adapters to render.
 * @returns Error message if this was an error result, undefined otherwise
 */
function handleSDKMessage(
  message: SDKMessage,
  options: InstallerOptions,
  collectedText: string[],
  emitter?: InstallerEventEmitter,
): string | undefined {
  logInfo(`SDK Message: ${message.type}`, JSON.stringify(message, null, 2));

  switch (message.type) {
    case 'assistant': {
      // Extract usage data from Anthropic API response for telemetry
      const usage = message.message?.usage;
      if (usage) {
        const inputTokens = usage.input_tokens ?? 0;
        const outputTokens = usage.output_tokens ?? 0;
        const model = message.message?.model ?? 'unknown';
        analytics.llmRequest(model, inputTokens, outputTokens);
        analytics.incrementAgentIterations();
      }

      // Extract text content from assistant messages
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            collectedText.push(block.text);

            // Emit output event for dashboard
            emitter?.emit('output', { text: block.text });

            // Check for [STATUS] markers and emit progress events
            const statusRegex = new RegExp(
              `^.*${AgentSignals.STATUS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(.+?)$`,
              'm',
            );
            const statusMatch = block.text.match(statusRegex);
            if (statusMatch) {
              const statusText = statusMatch[1].trim();
              // Emit progress event - adapters handle spinner updates
              emitter?.emit('agent:progress', { step: statusText });
              emitter?.emit('status', { message: statusText });
            }
          }

          // Check for tool_use blocks (Write/Edit operations)
          if (block.type === 'tool_use') {
            const toolName = block.name as string;
            const toolUseId = block.id as string;
            const input = block.input as Record<string, unknown>;

            // Log tool usage for debugging
            logInfo(`Tool use: ${toolName}`);

            // Track tool start time for telemetry
            if (toolUseId) {
              pendingToolCalls.set(toolUseId, { toolName, startTime: Date.now() });
            }

            // Emit file:write event for Write tool
            if (toolName === 'Write' && input) {
              const filePath = input.file_path as string;
              const fileContent = input.content as string;
              if (filePath && fileContent) {
                emitter?.emit('file:write', { path: filePath, content: fileContent });
              }
            }

            // Emit file:edit event for Edit tool
            if (toolName === 'Edit' && input) {
              const filePath = input.file_path as string;
              const oldString = input.old_string as string;
              const newString = input.new_string as string;
              if (filePath && oldString !== undefined && newString !== undefined) {
                // Emit the actual strings being replaced, not reconstructed full file
                emitter?.emit('file:edit', {
                  path: filePath,
                  oldContent: oldString,
                  newContent: newString,
                });
              }
            }

            // Track Read operations for caching file content later
            if (toolName === 'Read' && input && block.id) {
              const filePath = input.file_path as string;
              if (filePath) {
                pendingReads.set(block.id as string, filePath);
              }
            }
          }
        }
      }
      break;
    }

    case 'user': {
      // User messages contain tool results
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          // Tool results contain file content from Read operations
          if (block.type === 'tool_result' && block.tool_use_id) {
            const toolUseId = block.tool_use_id as string;

            // Emit telemetry for completed tool call
            const pendingTool = pendingToolCalls.get(toolUseId);
            if (pendingTool) {
              const durationMs = Date.now() - pendingTool.startTime;
              // Check if tool result indicates error (is_error field or error in content)
              const isError = block.is_error === true;
              analytics.toolCalled(pendingTool.toolName, durationMs, !isError);
              pendingToolCalls.delete(toolUseId);
            }

            const filePath = pendingReads.get(toolUseId);
            if (filePath) {
              // Extract content from the tool result
              let resultContent = '';
              if (typeof block.content === 'string') {
                resultContent = block.content;
              } else if (Array.isArray(block.content)) {
                // Content might be array of text blocks
                for (const item of block.content) {
                  if (item.type === 'text' && item.text) {
                    resultContent += item.text;
                  }
                }
              }
              if (resultContent) {
                fileContentCache.set(filePath, resultContent);
              }
              pendingReads.delete(toolUseId);
            }
          }
        }
      }
      break;
    }

    case 'tool': {
      // This case may not be used by the current SDK, keeping for compatibility
      const toolName = message.tool as string;
      const input = message.input as Record<string, unknown> | undefined;

      if (toolName === 'Read' && message.content) {
        const filePath = input?.file_path as string;
        if (filePath && typeof message.content === 'string') {
          fileContentCache.set(filePath, message.content);
        }
      }

      break;
    }

    case 'result': {
      if (message.subtype === 'success') {
        logInfo('Agent completed successfully');
        if (typeof message.result === 'string') {
          collectedText.push(message.result);
        }
      } else {
        // Error result
        logError('Agent error result:', message.subtype);
        if (message.errors && message.errors.length > 0) {
          for (const err of message.errors) {
            logError('ERROR:', err);
            // Emit error event - adapters handle rendering
            emitter?.emit('error', { message: err });
          }
          // Return the first error message
          return message.errors[0];
        }
        // Return generic error if subtype indicates failure but no errors array
        return `Agent execution failed: ${message.subtype}`;
      }
      break;
    }

    case 'system': {
      if (message.subtype === 'init') {
        logInfo('Agent session initialized', {
          model: message.model,
          tools: message.tools?.length,
          mcpServers: message.mcp_servers,
        });
      }
      break;
    }

    default:
      // Log other message types for debugging
      if (options.debug) {
        debug(`Unhandled message type: ${message.type}`);
      }
      break;
  }
  return undefined;
}

/**
 * Get the active proxy handle (for testing/debugging).
 */
export function getActiveProxyHandle(): CredentialProxyHandle | null {
  return activeProxyHandle;
}

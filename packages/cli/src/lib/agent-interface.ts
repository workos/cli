/**
 * Shared agent interface for WorkOS wizards
 * Uses Claude Agent SDK directly with WorkOS MCP server
 */

import path from 'path';
import { fileURLToPath } from 'url';
import clack from '../utils/clack.js';
import {
  debug,
  logToFile,
  initLogFile,
  LOG_FILE_PATH,
} from '../utils/debug.js';
import type { WizardOptions } from '../utils/types.js';
import { analytics } from '../utils/analytics.js';
import { WIZARD_INTERACTION_EVENT_NAME } from './constants.js';
import { LINTING_TOOLS } from './safe-tools.js';
import { getLlmGatewayUrlFromHost } from '../utils/urls.js';
import { getSettings } from './settings.js';
import { getAccessToken } from './credentials.js';

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
):
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string } {
  // Allow all non-Bash tools
  if (toolName !== 'Bash') {
    return { behavior: 'allow', updatedInput: input };
  }

  const command = (
    typeof input.command === 'string' ? input.command : ''
  ).trim();

  // Block definitely dangerous operators: ; ` $ ( )
  if (DANGEROUS_OPERATORS.test(command)) {
    logToFile(`Denying bash command with dangerous operators: ${command}`);
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
      logToFile(`Denying bash command with multiple pipes: ${command}`);
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
      logToFile(`Allowing bash command with output limiter: ${command}`);
      debug(`Allowing bash command with output limiter: ${command}`);
      return { behavior: 'allow', updatedInput: input };
    }
  }

  // Block remaining pipes and & (not covered by tail/head case above)
  if (/[|&]/.test(normalized)) {
    logToFile(`Denying bash command with pipe/&: ${command}`);
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
    logToFile(`Allowing bash command: ${command}`);
    debug(`Allowing bash command: ${command}`);
    return { behavior: 'allow', updatedInput: input };
  }

  logToFile(`Denying bash command: ${command}`);
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
export function initializeAgent(
  config: AgentConfig,
  options: WizardOptions,
): AgentRunConfig {
  // Initialize log file for this run
  initLogFile();
  logToFile('Agent initialization starting');
  logToFile('Install directory:', options.installDir);

  clack.log.step('Initializing Claude agent...');

  try {
    // Configure LLM gateway for Claude API calls
    // Local testing: use localhost LLM gateway
    // Production: use WorkOS production gateway
    const settings = getSettings();
    const gatewayUrl = options.local
      ? settings.gateway.development
      : getLlmGatewayUrlFromHost();

    const userToken = getAccessToken();
    if (!userToken) {
      throw new Error('Not authenticated. Run `wizard login` to authenticate.');
    }

    process.env.ANTHROPIC_BASE_URL = gatewayUrl;
    process.env.ANTHROPIC_AUTH_TOKEN = userToken;

    const authMode = options.local
      ? `local-gateway:${gatewayUrl}`
      : `workos-gateway:${gatewayUrl}`;

    logToFile('Configured LLM gateway:', gatewayUrl);

    // Disable experimental betas (like input_examples) that the LLM gateway doesn't support
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = 'true';

    // Configure WorkOS MCP docs server for accessing WorkOS documentation
    const agentRunConfig: AgentRunConfig = {
      workingDirectory: config.workingDirectory,
      mcpServers: {
        workos: {
          command: 'npx',
          args: ['-y', '@workos/mcp-docs-server'],
        },
      },
      model: settings.model,
      allowedTools: [
        'Skill',
        'Read',
        'Write',
        'Edit',
        'Bash',
        'Glob',
        'Grep',
        'WebFetch',
      ],
    };

    logToFile('Agent config:', {
      workingDirectory: agentRunConfig.workingDirectory,
      gatewayUrl,
      authMode,
      useMcp: false,
    });

    if (options.debug) {
      debug('Agent config:', {
        workingDirectory: agentRunConfig.workingDirectory,
        gatewayUrl,
        authMode,
        useMcp: false,
      });
    }

    clack.log.step(`Verbose logs: ${LOG_FILE_PATH}`);
    clack.log.success("Agent initialized. Let's get cooking!");
    return agentRunConfig;
  } catch (error) {
    clack.log.error(`Failed to initialize agent: ${(error as Error).message}`);
    logToFile('Agent initialization error:', error);
    debug('Agent initialization error:', error);
    throw error;
  }
}

/**
 * Execute an agent with the provided prompt and options
 * Handles the full lifecycle: spinner, execution, error handling
 *
 * @returns An object containing any error detected in the agent's output
 */
export async function runAgent(
  agentConfig: AgentRunConfig,
  prompt: string,
  options: WizardOptions,
  spinner: ReturnType<typeof clack.spinner>,
  config?: {
    spinnerMessage?: string;
    successMessage?: string;
    errorMessage?: string;
  },
): Promise<{ error?: AgentErrorType }> {
  const {
    spinnerMessage = 'Setting up WorkOS AuthKit...',
    successMessage = 'WorkOS AuthKit integration complete',
    errorMessage = 'Integration failed',
  } = config ?? {};

  const { query } = await getSDKModule();

  clack.log.step(`This may take a few minutes. Grab some coffee!`);

  spinner.start(spinnerMessage);

  logToFile('Starting agent run');
  logToFile('Prompt:', prompt);

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
    logToFile('Loading plugin from:', pluginPath);

    const response = query({
      prompt: createPromptStream(),
      options: {
        model: agentConfig.model,
        cwd: agentConfig.workingDirectory,
        permissionMode: 'acceptEdits',
        mcpServers: agentConfig.mcpServers,
        env: { ...process.env },
        canUseTool: (toolName: string, input: unknown) => {
          logToFile('canUseTool called:', { toolName, input });
          const result = wizardCanUseTool(
            toolName,
            input as Record<string, unknown>,
          );
          logToFile('canUseTool result:', result);
          return Promise.resolve(result);
        },
        tools: { type: 'preset', preset: 'claude_code' },
        allowedTools: agentConfig.allowedTools,
        plugins: [{ type: 'local', path: pluginPath }],
        // Capture stderr from CLI subprocess for debugging
        stderr: (data: string) => {
          logToFile('CLI stderr:', data);
          if (options.debug) {
            debug('CLI stderr:', data);
          }
        },
      },
    });

    // Process the async generator
    for await (const message of response) {
      handleSDKMessage(message, options, spinner, collectedText);
      // Signal completion when result received
      if (message.type === 'result') {
        signalDone!();
      }
    }

    const durationMs = Date.now() - startTime;
    const outputText = collectedText.join('\n');

    // Check for error markers in the agent's output
    if (outputText.includes(AgentSignals.ERROR_MCP_MISSING)) {
      logToFile('Agent error: MCP_MISSING');
      spinner.stop('Agent could not access WorkOS MCP');
      return { error: AgentErrorType.MCP_MISSING };
    }

    if (outputText.includes(AgentSignals.ERROR_RESOURCE_MISSING)) {
      logToFile('Agent error: RESOURCE_MISSING');
      spinner.stop('Agent could not access setup resource');
      return { error: AgentErrorType.RESOURCE_MISSING };
    }

    logToFile(`Agent run completed in ${Math.round(durationMs / 1000)}s`);
    analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
      action: 'agent integration completed',
      duration_ms: durationMs,
      duration_seconds: Math.round(durationMs / 1000),
    });

    spinner.stop(successMessage);
    return {};
  } catch (error) {
    spinner.stop(errorMessage);
    clack.log.error(`Error: ${(error as Error).message}`);
    logToFile('Agent run failed:', error);
    debug('Full error:', error);
    throw error;
  }
}

/**
 * Handle SDK messages and provide user feedback
 */
function handleSDKMessage(
  message: SDKMessage,
  options: WizardOptions,
  spinner: ReturnType<typeof clack.spinner>,
  collectedText: string[],
): void {
  logToFile(`SDK Message: ${message.type}`, JSON.stringify(message, null, 2));

  if (options.debug) {
    debug(`SDK Message type: ${message.type}`);
  }

  switch (message.type) {
    case 'assistant': {
      // Extract text content from assistant messages
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            collectedText.push(block.text);

            // Check for [STATUS] markers
            const statusRegex = new RegExp(
              `^.*${AgentSignals.STATUS.replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&',
              )}\\s*(.+?)$`,
              'm',
            );
            const statusMatch = block.text.match(statusRegex);
            if (statusMatch) {
              spinner.stop(statusMatch[1].trim());
              spinner.start('Setting up WorkOS AuthKit...');
            }
          }
        }
      }
      break;
    }

    case 'result': {
      if (message.subtype === 'success') {
        logToFile('Agent completed successfully');
        if (typeof message.result === 'string') {
          collectedText.push(message.result);
        }
      } else {
        // Error result
        logToFile('Agent error result:', message.subtype);
        if (message.errors) {
          for (const err of message.errors) {
            clack.log.error(`Error: ${err}`);
            logToFile('ERROR:', err);
          }
        }
      }
      break;
    }

    case 'system': {
      if (message.subtype === 'init') {
        logToFile('Agent session initialized', {
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
}

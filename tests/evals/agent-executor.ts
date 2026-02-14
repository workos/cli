import path from 'node:path';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCredentials } from './env-loader.js';
import { writeEnvLocal } from '../../src/lib/env-writer.js';
import { parseEnvFile } from '../../src/utils/env-parser.js';
import { getConfig } from '../../src/lib/settings.js';
import { LatencyTracker } from './latency-tracker.js';
import { runQuickChecks } from '../../src/lib/validation/quick-checks.js';
import type { ToolCall, LatencyMetrics } from './types.js';

export interface AgentResult {
  success: boolean;
  output: string;
  toolCalls: ToolCall[];
  error?: string;
  latencyMetrics?: LatencyMetrics;
  /** Number of within-session correction attempts */
  correctionAttempts: number;
  /** Whether the agent self-corrected after an initial failure */
  selfCorrected: boolean;
}

export interface AgentRetryConfig {
  /** Enable within-session correction. Default: true */
  enabled: boolean;
  /** Max correction attempts. Default: 2 */
  maxRetries: number;
}

export interface AgentExecutorOptions {
  verbose?: boolean;
  scenarioName?: string;
}

// Skill name mapping for each framework
const SKILL_NAMES: Record<string, string> = {
  nextjs: 'workos-authkit-nextjs',
  react: 'workos-authkit-react',
  'react-router': 'workos-authkit-react-router',
  'tanstack-start': 'workos-authkit-tanstack-start',
  'vanilla-js': 'workos-authkit-vanilla-js',
  // New SDKs
  sveltekit: 'workos-authkit-sveltekit',
  node: 'workos-node',
  python: 'workos-python',
  ruby: 'workos-ruby',
  go: 'workos-go',
  php: 'workos-php',
  'php-laravel': 'workos-php-laravel',
  kotlin: 'workos-kotlin',
  dotnet: 'workos-dotnet',
  elixir: 'workos-elixir',
};

/** Frameworks that use package.json / .env.local */
const JS_FRAMEWORKS = ['nextjs', 'react', 'react-router', 'tanstack-start', 'vanilla-js', 'sveltekit', 'node'];

/**
 * Write a .env file (for non-JS frameworks).
 * Merges with existing .env if present.
 */
function writeEnvFile(workDir: string, envVars: Record<string, string>): void {
  const envPath = join(workDir, '.env');
  let existing: Record<string, string> = {};
  if (existsSync(envPath)) {
    existing = parseEnvFile(readFileSync(envPath, 'utf-8'));
  }
  const merged = { ...existing, ...envVars };
  const content = Object.entries(merged)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  writeFileSync(envPath, content + '\n');
}

export class AgentExecutor {
  private options: AgentExecutorOptions;
  private credentials: ReturnType<typeof loadCredentials>;
  private latencyTracker: LatencyTracker;

  constructor(
    private workDir: string,
    private framework: string,
    options: AgentExecutorOptions = {},
  ) {
    this.options = options;
    this.credentials = loadCredentials();
    this.latencyTracker = new LatencyTracker();
  }

  async run(retryConfig?: AgentRetryConfig): Promise<AgentResult> {
    const config = retryConfig ?? { enabled: true, maxRetries: 2 };
    const integration = this.getIntegration();
    const toolCalls: ToolCall[] = [];
    const collectedOutput: string[] = [];

    const label = this.options.scenarioName ? `[${this.options.scenarioName}]` : '';
    if (this.options.verbose) {
      console.log(`${label} Initializing agent for ${integration}...`);
    }

    // Start latency tracking
    this.latencyTracker.start();

    // Write credentials to appropriate env file based on framework
    const envVars = {
      WORKOS_API_KEY: this.credentials.workosApiKey,
      WORKOS_CLIENT_ID: this.credentials.workosClientId,
    };

    if (JS_FRAMEWORKS.includes(this.framework)) {
      writeEnvLocal(this.workDir, envVars);
    } else {
      writeEnvFile(this.workDir, envVars);
    }

    // Build prompt
    const skillName = SKILL_NAMES[integration];
    const prompt = this.buildPrompt(skillName);

    // Retry loop coordination
    let correctionAttempts = 0;
    const maxRetries = config.enabled ? config.maxRetries : 0;
    const workDir = this.workDir;

    // Turn completion signals
    let resolveCurrentTurn!: () => void;
    let currentTurnDone!: Promise<void>;

    function resetTurnSignal() {
      currentTurnDone = new Promise<void>((resolve) => {
        resolveCurrentTurn = resolve;
      });
    }
    resetTurnSignal();

    // Initialize and run agent
    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');

      // Build SDK environment for direct mode
      const sdkEnv: Record<string, string | undefined> = {
        ...process.env,
        ANTHROPIC_API_KEY: this.credentials.anthropicApiKey,
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: 'true',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'true',
      };
      // Remove gateway config to use direct API
      delete sdkEnv.ANTHROPIC_BASE_URL;
      delete sdkEnv.ANTHROPIC_AUTH_TOKEN;

      // Get plugin path for skills
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const pluginPath = path.join(__dirname, '../..');

      // Retry-aware prompt stream (same pattern as production agent-interface.ts)
      const createPromptStream = async function* () {
        yield {
          type: 'user',
          session_id: '',
          message: { role: 'user', content: prompt },
          parent_tool_use_id: null,
        };

        if (maxRetries > 0) {
          while (correctionAttempts < maxRetries) {
            await currentTurnDone;

            let validationPrompt: string | null;
            try {
              const quickResult = await runQuickChecks(workDir);
              validationPrompt = quickResult.passed ? null : quickResult.agentRetryPrompt;
            } catch {
              validationPrompt = null; // treat validation errors as passed
            }

            if (validationPrompt === null) break;

            correctionAttempts++;
            if (label && process.env.EVAL_VERBOSE) {
              console.log(`${label} Correction attempt ${correctionAttempts}/${maxRetries}`);
            }

            resetTurnSignal();

            yield {
              type: 'user',
              session_id: '',
              message: { role: 'user', content: validationPrompt },
              parent_tool_use_id: null,
            };
          }
        }

        // Keep generator alive until final result
        await currentTurnDone;
      };

      const response = query({
        prompt: createPromptStream(),
        options: {
          model: getConfig().model,
          cwd: this.workDir,
          permissionMode: 'acceptEdits',
          mcpServers: {
            workos: {
              command: 'npx',
              args: ['-y', '@workos/mcp-docs-server'],
            },
          },
          env: sdkEnv,
          tools: { type: 'preset', preset: 'claude_code' },
          allowedTools: ['Skill', 'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch'],
          plugins: [{ type: 'local', path: pluginPath }],
        },
      });

      // Process message stream — signal turn completion on result
      for await (const message of response) {
        this.handleMessage(message, toolCalls, collectedOutput, label);
        if (message.type === 'result') {
          resolveCurrentTurn();
        }
      }

      const latencyMetrics = this.latencyTracker.finish();
      return {
        success: true,
        output: collectedOutput.join('\n'),
        toolCalls,
        latencyMetrics,
        correctionAttempts,
        selfCorrected: correctionAttempts > 0,
      };
    } catch (error) {
      const latencyMetrics = this.latencyTracker.finish();
      return {
        success: false,
        output: collectedOutput.join('\n'),
        toolCalls,
        latencyMetrics,
        error: error instanceof Error ? error.message : String(error),
        correctionAttempts,
        selfCorrected: false,
      };
    }
  }

  private buildPrompt(skillName: string): string {
    return `You are integrating WorkOS AuthKit into this application.

## Project Context
- Framework: ${this.framework}
- Working directory: ${this.workDir}

## Environment
The following environment variables have been configured in .env.local:
- WORKOS_API_KEY
- WORKOS_CLIENT_ID

## Your Task
Use the \`${skillName}\` skill to integrate WorkOS AuthKit into this application.

Begin by invoking the ${skillName} skill.`;
  }

  private handleMessage(message: any, toolCalls: ToolCall[], collectedOutput: string[], label: string): void {
    if (message.type === 'assistant') {
      // End any in-progress tool call when we get a new assistant message
      this.latencyTracker.endToolCall();

      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          // Capture text output and track TTFT
          if (block.type === 'text' && typeof block.text === 'string') {
            this.latencyTracker.recordFirstContent();
            collectedOutput.push(block.text);
            if (this.options.verbose) {
              console.log(`${label} Agent: ${block.text.slice(0, 100)}...`);
            }
          }
          // Capture tool calls and start timing
          if (block.type === 'tool_use') {
            this.latencyTracker.startToolCall(block.name);
            const call: ToolCall = {
              tool: block.name,
              input: block.input as Record<string, unknown>,
            };
            toolCalls.push(call);
            if (this.options.verbose) {
              console.log(`${label} Tool: ${block.name}`);
            }
          }
        }
      }
    }

    if (message.type === 'result') {
      // Capture token usage from result
      if (message.usage) {
        this.latencyTracker.recordTokens(message.usage.input_tokens ?? 0, message.usage.output_tokens ?? 0);
      }
      if (message.subtype !== 'success' && message.errors?.length > 0) {
        collectedOutput.push(`Error: ${message.errors.join(', ')}`);
      }
    }
  }

  private getIntegration(): string {
    // Integration is now a string type — framework name IS the integration name
    return this.framework;
  }
}

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCredentials } from './env-loader.js';
import { writeEnvLocal } from '../../src/lib/env-writer.js';
import { parseEnvFile } from '../../src/utils/env-parser.js';
import { getConfig } from '../../src/lib/settings.js';
import { LatencyTracker } from './latency-tracker.js';
import { quickCheckValidateAndFormat } from '../../src/lib/validation/quick-checks.js';
import { runAgent, type AgentRunConfig, type RetryConfig } from '../../src/lib/agent-interface.js';
import type { InstallerOptions } from '../../src/utils/types.js';
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
    const toolCalls: ToolCall[] = [];
    const collectedOutput: string[] = [];

    const label = this.options.scenarioName ? `[${this.options.scenarioName}]` : '';
    if (this.options.verbose) {
      console.log(`${label} Initializing agent for ${this.framework}...`);
    }

    this.latencyTracker.start();

    const envVars = {
      WORKOS_API_KEY: this.credentials.workosApiKey,
      WORKOS_CLIENT_ID: this.credentials.workosClientId,
    };

    if (JS_FRAMEWORKS.includes(this.framework)) {
      writeEnvLocal(this.workDir, envVars);
    } else {
      writeEnvFile(this.workDir, envVars);
    }

    const skillName = SKILL_NAMES[this.framework];
    const prompt = this.buildPrompt(skillName);

    const sdkEnv: Record<string, string | undefined> = {
      ...process.env,
      ANTHROPIC_API_KEY: this.credentials.anthropicApiKey,
      ANTHROPIC_BASE_URL: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: 'true',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'true',
    };

    const agentRunConfig: AgentRunConfig = {
      workingDirectory: this.workDir,
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

    const installerOptions: InstallerOptions = {
      debug: this.options.verbose ?? false,
      forceInstall: false,
      installDir: this.workDir,
      local: false,
      ci: true,
      skipAuth: true,
    };

    const prodRetryConfig: RetryConfig | undefined = config.enabled
      ? { maxRetries: config.maxRetries, validateAndFormat: quickCheckValidateAndFormat }
      : undefined;

    try {
      // Delegate to production runAgent — same retry loop, same generator coordination
      const result = await runAgent(
        agentRunConfig,
        prompt,
        installerOptions,
        undefined, // no spinner config
        undefined, // no emitter
        prodRetryConfig,
        (message) => this.trackMessage(message, toolCalls, collectedOutput, label),
      );

      const latencyMetrics = this.latencyTracker.finish();
      const correctionAttempts = result.retryCount ?? 0;
      const base = { output: collectedOutput.join('\n'), toolCalls, latencyMetrics, correctionAttempts };

      if (result.error) {
        return { ...base, success: false, error: result.errorMessage ?? String(result.error), selfCorrected: false };
      }

      return { ...base, success: true, selfCorrected: correctionAttempts > 0 };
    } catch (error) {
      return {
        success: false,
        output: collectedOutput.join('\n'),
        toolCalls,
        latencyMetrics: this.latencyTracker.finish(),
        error: error instanceof Error ? error.message : String(error),
        correctionAttempts: 0,
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

  /**
   * Observe SDK messages for latency tracking and output collection.
   * This is called via the onMessage hook — production handleSDKMessage runs first.
   */
  private trackMessage(message: any, toolCalls: ToolCall[], collectedOutput: string[], label: string): void {
    if (message.type === 'assistant') {
      this.latencyTracker.endToolCall();

      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            this.latencyTracker.recordFirstContent();
            collectedOutput.push(block.text);
            if (this.options.verbose) {
              console.log(`${label} Agent: ${block.text.slice(0, 100)}...`);
            }
          }
          if (block.type === 'tool_use') {
            this.latencyTracker.startToolCall(block.name);
            toolCalls.push({
              tool: block.name,
              input: block.input as Record<string, unknown>,
            });
            if (this.options.verbose) {
              console.log(`${label} Tool: ${block.name}`);
            }
          }
        }
      }
    }

    if (message.type === 'result') {
      if (message.usage) {
        this.latencyTracker.recordTokens(message.usage.input_tokens ?? 0, message.usage.output_tokens ?? 0);
      }
      if (message.subtype !== 'success' && message.errors?.length > 0) {
        collectedOutput.push(`Error: ${message.errors.join(', ')}`);
      }
    }
  }

}

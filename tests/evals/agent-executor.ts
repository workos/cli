import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Integration } from '../../src/lib/constants.js';
import { loadCredentials } from './env-loader.js';
import { writeEnvLocal } from '../../src/lib/env-writer.js';
import { getConfig } from '../../src/lib/settings.js';
import { LatencyTracker } from './latency-tracker.js';
import type { ToolCall, LatencyMetrics } from './types.js';

export interface AgentResult {
  success: boolean;
  output: string;
  toolCalls: ToolCall[];
  error?: string;
  latencyMetrics?: LatencyMetrics;
}

export interface AgentExecutorOptions {
  verbose?: boolean;
  scenarioName?: string;
}

// Skill name mapping for each framework
const SKILL_NAMES: Record<Integration, string> = {
  [Integration.nextjs]: 'workos-authkit-nextjs',
  [Integration.react]: 'workos-authkit-react',
  [Integration.reactRouter]: 'workos-authkit-react-router',
  [Integration.tanstackStart]: 'workos-authkit-tanstack-start',
  [Integration.vanillaJs]: 'workos-authkit-vanilla-js',
};

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

  async run(): Promise<AgentResult> {
    const integration = this.getIntegration();
    const toolCalls: ToolCall[] = [];
    const collectedOutput: string[] = [];

    const label = this.options.scenarioName ? `[${this.options.scenarioName}]` : '';
    if (this.options.verbose) {
      console.log(`${label} Initializing agent for ${integration}...`);
    }

    // Start latency tracking
    this.latencyTracker.start();

    // Write .env.local with credentials (agent configures redirect URI per framework)
    writeEnvLocal(this.workDir, {
      WORKOS_API_KEY: this.credentials.workosApiKey,
      WORKOS_CLIENT_ID: this.credentials.workosClientId,
    });

    // Build prompt
    const skillName = SKILL_NAMES[integration];
    const prompt = this.buildPrompt(skillName);

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

      const response = query({
        prompt: prompt,
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

      // Process message stream
      for await (const message of response) {
        this.handleMessage(message, toolCalls, collectedOutput, label);
      }

      const latencyMetrics = this.latencyTracker.finish();
      return {
        success: true,
        output: collectedOutput.join('\n'),
        toolCalls,
        latencyMetrics,
      };
    } catch (error) {
      const latencyMetrics = this.latencyTracker.finish();
      return {
        success: false,
        output: collectedOutput.join('\n'),
        toolCalls,
        latencyMetrics,
        error: error instanceof Error ? error.message : String(error),
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
        this.latencyTracker.recordTokens(
          message.usage.input_tokens ?? 0,
          message.usage.output_tokens ?? 0,
        );
      }
      if (message.subtype !== 'success' && message.errors?.length > 0) {
        collectedOutput.push(`Error: ${message.errors.join(', ')}`);
      }
    }
  }

  private getIntegration(): Integration {
    const map: Record<string, Integration> = {
      nextjs: Integration.nextjs,
      react: Integration.react,
      'react-router': Integration.reactRouter,
      'tanstack-start': Integration.tanstackStart,
      'vanilla-js': Integration.vanillaJs,
    };
    return map[this.framework];
  }
}

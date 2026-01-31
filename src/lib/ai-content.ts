import Anthropic from '@anthropic-ai/sdk';
import { startCredentialProxy } from './credential-proxy.js';
import { getLlmGatewayUrl, getAuthkitDomain, getCliAuthClientId, getConfig } from './settings.js';
import { getCredentials } from './credentials.js';
import { logInfo, logError } from '../utils/debug.js';

export interface AiContentOptions {
  /** Use direct Anthropic API instead of llm-gateway */
  direct?: boolean;
}

/**
 * Execute an API call through a short-lived credential proxy.
 * Handles proxy lifecycle automatically.
 */
async function withProxy<T>(fn: (client: Anthropic) => Promise<T>): Promise<T> {
  const gatewayUrl = getLlmGatewayUrl();
  const creds = getCredentials();

  if (!creds?.refreshToken) {
    // No refresh token - use credentials directly (legacy mode)
    logInfo('[ai-content] No refresh token, using credentials directly');
    const client = new Anthropic({
      baseURL: gatewayUrl,
      apiKey: 'gateway', // SDK requires something, gateway uses Authorization header
      defaultHeaders: creds?.accessToken ? { Authorization: `Bearer ${creds.accessToken}` } : undefined,
    });
    return fn(client);
  }

  // Start short-lived proxy
  const proxy = await startCredentialProxy({
    upstreamUrl: gatewayUrl,
    refresh: {
      authkitDomain: getAuthkitDomain(),
      clientId: getCliAuthClientId(),
      refreshThresholdMs: getConfig().proxy.refreshThresholdMs,
    },
  });

  logInfo(`[ai-content] Started proxy at ${proxy.url}`);

  try {
    const client = new Anthropic({
      baseURL: proxy.url,
      apiKey: 'proxy', // SDK requires something, proxy handles real auth
    });
    return await fn(client);
  } finally {
    await proxy.stop();
    logInfo('[ai-content] Stopped proxy');
  }
}

/**
 * Execute an API call directly to Anthropic (--direct mode).
 */
async function withDirect<T>(fn: (client: Anthropic) => Promise<T>): Promise<T> {
  // SDK reads ANTHROPIC_API_KEY from env automatically
  const client = new Anthropic();
  return fn(client);
}

/**
 * Generate a concise commit message for the AuthKit integration.
 * Falls back to a default message if AI generation fails.
 */
export async function generateCommitMessage(
  integration: string,
  files: string[],
  options: AiContentOptions = {},
): Promise<string> {
  const executor = options.direct ? withDirect : withProxy;

  try {
    return await executor(async (client) => {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: `Generate a concise git commit message for adding WorkOS AuthKit to a ${integration} project. Changed files: ${files.slice(0, 10).join(', ')}. Use conventional commit format (feat:). One line only, under 72 chars.`,
          },
        ],
      });

      const text = response.content[0];
      if (text.type === 'text') {
        return text.text.trim();
      }
      throw new Error('Unexpected response format');
    });
  } catch (error) {
    logError('[ai-content] Failed to generate commit message:', error);
    return `feat: add WorkOS AuthKit integration for ${integration}`;
  }
}

/**
 * Generate a PR description for the AuthKit integration.
 * Falls back to a default template if AI generation fails.
 */
export async function generatePrDescription(
  integration: string,
  files: string[],
  commitMessage: string,
  options: AiContentOptions = {},
): Promise<string> {
  const executor = options.direct ? withDirect : withProxy;

  try {
    return await executor(async (client) => {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: `Generate a GitHub PR description for: "${commitMessage}"

Framework: ${integration}
Files changed: ${files.join(', ')}

Include:
- Brief summary (2-3 sentences)
- Key changes bullet list
- Link to WorkOS AuthKit docs: https://workos.com/docs/user-management

Keep it concise. Markdown format.`,
          },
        ],
      });

      const text = response.content[0];
      if (text.type === 'text') {
        return text.text.trim();
      }
      throw new Error('Unexpected response format');
    });
  } catch (error) {
    logError('[ai-content] Failed to generate PR description:', error);
    return `## Summary
Added WorkOS AuthKit integration for ${integration}.

## Changes
${files.map((f) => `- ${f}`).join('\n')}

## Documentation
https://workos.com/docs/user-management`;
  }
}

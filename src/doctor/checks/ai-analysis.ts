import { hasCredentials, getCredentials, isTokenExpired } from '../../lib/credentials.js';
import { ensureValidToken } from '../../lib/token-refresh.js';
import { startCredentialProxy, type CredentialProxyHandle } from '../../lib/credential-proxy.js';
import { getAuthkitDomain, getCliAuthClientId } from '../../lib/settings.js';
import { getLlmGatewayUrlFromHost } from '../../utils/urls.js';
import { buildDoctorPrompt, type AnalysisContext } from '../agent-prompt.js';
import type { AiAnalysis, AiFinding } from '../types.js';

const DOCTOR_MODEL = 'claude-sonnet-4-5-20250514';
const TIMEOUT_MS = 60_000;

/**
 * Parse AI agent response to extract structured JSON findings.
 * Handles both clean JSON and JSON embedded in markdown code blocks.
 */
export function parseAiResponse(text: string): { findings: AiFinding[]; summary: string } {
  // Try to extract JSON from markdown code block first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1] : text;

  try {
    const parsed = JSON.parse(jsonStr.trim());
    const findings = Array.isArray(parsed.findings)
      ? parsed.findings.map((f: Record<string, unknown>) => ({
          severity: (['error', 'warning', 'info'].includes(f.severity as string) ? f.severity : 'info') as
            | 'error'
            | 'warning'
            | 'info',
          title: String(f.title ?? ''),
          detail: String(f.detail ?? ''),
          remediation: String(f.remediation ?? ''),
          filePath: f.filePath ? String(f.filePath) : undefined,
        }))
      : [];
    return { findings, summary: String(parsed.summary ?? '') };
  } catch {
    // Fallback: try to find any JSON object in the text
    const jsonMatch = text.match(/\{[\s\S]*"findings"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          findings: Array.isArray(parsed.findings) ? parsed.findings : [],
          summary: String(parsed.summary ?? ''),
        };
      } catch {
        // give up on JSON parsing
      }
    }

    // Final fallback: return the raw text as summary with no findings
    return { findings: [], summary: text.slice(0, 500) };
  }
}

export async function checkAiAnalysis(
  installDir: string,
  context: AnalysisContext,
  options: { skipAi?: boolean },
): Promise<AiAnalysis> {
  const skippedResult = (reason: string): AiAnalysis => ({
    findings: [],
    summary: '',
    model: DOCTOR_MODEL,
    durationMs: 0,
    skipped: true,
    skipReason: reason,
  });

  if (options.skipAi) {
    return skippedResult('Skipped (--skip-ai flag)');
  }

  // Check auth
  if (!hasCredentials()) {
    return skippedResult('Not authenticated — run `workos login` for AI-powered analysis');
  }

  const creds = getCredentials();
  if (!creds) {
    return skippedResult('No credentials found');
  }

  // Refresh token if needed
  if (isTokenExpired(creds)) {
    try {
      const result = await ensureValidToken();
      if (!result.success) {
        return skippedResult('Authentication expired — run `workos login` to re-authenticate');
      }
    } catch {
      return skippedResult('Authentication expired — run `workos login` to re-authenticate');
    }
  }

  const startTime = Date.now();
  let proxy: CredentialProxyHandle | null = null;

  try {
    // Start credential proxy
    const gatewayUrl = getLlmGatewayUrlFromHost();
    const authkitDomain = getAuthkitDomain();
    const clientId = getCliAuthClientId();

    proxy = await startCredentialProxy({
      upstreamUrl: gatewayUrl,
      refresh: { authkitDomain, clientId },
    });

    // Build prompt
    const prompt = buildDoctorPrompt(context);

    // Dynamically import the SDK
    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    // Run the agent with timeout
    const timeoutId = setTimeout(() => {
      response.close();
    }, TIMEOUT_MS);

    const collectedText: string[] = [];

    const response = query({
      prompt,
      options: {
        model: DOCTOR_MODEL,
        cwd: installDir,
        permissionMode: 'default',
        allowedTools: ['Read', 'Glob', 'Grep'],
        canUseTool: (toolName: string, input: unknown) => {
          if (['Read', 'Glob', 'Grep'].includes(toolName)) {
            return Promise.resolve({
              behavior: 'allow' as const,
              updatedInput: input as Record<string, unknown>,
            });
          }
          return Promise.resolve({
            behavior: 'deny' as const,
            message: `Tool ${toolName} not allowed in doctor analysis mode`,
          });
        },
        env: {
          ANTHROPIC_BASE_URL: proxy.url,
          CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: 'true',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'true',
        },
      },
    });

    try {
      for await (const message of response) {
        if (message.type === 'assistant') {
          const content = message.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && typeof block.text === 'string') {
                collectedText.push(block.text);
              }
            }
          }
        }
        if (message.type === 'result' && message.subtype === 'success') {
          if (typeof message.result === 'string') {
            collectedText.push(message.result);
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }

    const durationMs = Date.now() - startTime;
    const outputText = collectedText.join('\n');
    const { findings, summary } = parseAiResponse(outputText);

    return {
      findings,
      summary,
      model: DOCTOR_MODEL,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('abort') || message.includes('AbortError')) {
      return {
        ...skippedResult(`Analysis timed out after ${Math.round(TIMEOUT_MS / 1000)}s`),
        durationMs,
      };
    }

    return {
      ...skippedResult(`Analysis failed: ${message}`),
      durationMs,
    };
  } finally {
    if (proxy) {
      await proxy.stop().catch(() => {});
    }
  }
}

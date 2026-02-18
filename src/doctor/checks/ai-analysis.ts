import Anthropic from '@anthropic-ai/sdk';
import { getLlmGatewayUrl, getAuthkitDomain, getCliAuthClientId, getConfig } from '../../lib/settings.js';
import { getCredentials, isTokenExpired, updateTokens, diagnoseCredentials } from '../../lib/credentials.js';
import { refreshAccessToken } from '../../lib/token-refresh-client.js';
import { buildDoctorPrompt, type AnalysisContext } from '../agent-prompt.js';
import type { AiAnalysis, AiFinding } from '../types.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function startSpinner(message: string): { stop: () => void } {
  let i = 0;
  const interval = setInterval(() => {
    process.stderr.write(`\r  ${SPINNER_FRAMES[i++ % SPINNER_FRAMES.length]} ${message}`);
  }, 80);
  return {
    stop: () => {
      clearInterval(interval);
      process.stderr.write(`\r${' '.repeat(message.length + 6)}\r`);
    },
  };
}

export function parseAiResponse(text: string): { findings: AiFinding[]; summary: string } {
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
    const jsonMatch = text.match(/\{[\s\S]*"findings"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          findings: Array.isArray(parsed.findings) ? parsed.findings : [],
          summary: String(parsed.summary ?? ''),
        };
      } catch {
        // give up
      }
    }
    return { findings: [], summary: text.slice(0, 500) };
  }
}

async function callModel(prompt: string, model: string): Promise<string> {
  let creds = getCredentials();
  if (!creds) throw new Error('Not authenticated');

  if (isTokenExpired(creds)) {
    if (!creds.refreshToken) throw new Error('Session expired — run `workos login` to re-authenticate');
    const result = await refreshAccessToken(getAuthkitDomain(), getCliAuthClientId());
    if (!result.success || !result.accessToken || !result.expiresAt) {
      throw new Error('Session expired — run `workos login` to re-authenticate');
    }
    updateTokens(result.accessToken, result.expiresAt, result.refreshToken);
    creds = getCredentials()!;
  }

  const client = new Anthropic({
    baseURL: getLlmGatewayUrl(),
    apiKey: 'gateway',
    defaultHeaders: { Authorization: `Bearer ${creds.accessToken}` },
  });

  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0];
  if (text.type === 'text') return text.text;
  throw new Error('Unexpected response format');
}

export async function checkAiAnalysis(context: AnalysisContext, options: { skipAi?: boolean }): Promise<AiAnalysis> {
  const model = getConfig().doctorModel;

  const skippedResult = (reason: string): AiAnalysis => ({
    findings: [],
    summary: '',
    model,
    durationMs: 0,
    skipped: true,
    skipReason: reason,
  });

  if (options.skipAi) {
    return skippedResult('Skipped (--skip-ai flag)');
  }

  const creds = getCredentials();
  if (!creds) {
    const diag = diagnoseCredentials();
    process.stderr.write('\n  [credential-debug]\n');
    for (const line of diag) {
      process.stderr.write(`    ${line}\n`);
    }
    process.stderr.write('\n');
    return skippedResult('Not authenticated — run `workos login` for AI-powered analysis');
  }

  const startTime = Date.now();
  const spinner = startSpinner('Analyzing project with AI...');

  try {
    const prompt = await buildDoctorPrompt(context);
    const responseText = await callModel(prompt, model);
    const durationMs = Date.now() - startTime;
    const { findings, summary } = parseAiResponse(responseText);
    return { findings, summary, model, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    return { ...skippedResult(`Analysis failed: ${errMsg}`), durationMs };
  } finally {
    spinner.stop();
  }
}

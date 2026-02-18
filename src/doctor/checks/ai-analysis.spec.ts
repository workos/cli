import { describe, it, expect } from 'vitest';
import { parseAiResponse } from './ai-analysis.js';
import { buildDoctorPrompt, type AnalysisContext } from '../agent-prompt.js';

describe('ai-analysis', () => {
  describe('parseAiResponse', () => {
    it('parses valid JSON with findings', () => {
      const json = JSON.stringify({
        findings: [
          {
            severity: 'warning',
            title: 'Missing middleware',
            detail: 'No auth middleware found',
            remediation: 'Add middleware.ts',
            filePath: 'src/middleware.ts',
          },
        ],
        summary: 'Integration needs work',
      });
      const result = parseAiResponse(json);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].severity).toBe('warning');
      expect(result.findings[0].title).toBe('Missing middleware');
      expect(result.findings[0].filePath).toBe('src/middleware.ts');
      expect(result.summary).toBe('Integration needs work');
    });

    it('parses JSON inside markdown code block', () => {
      const text = `Here is my analysis:

\`\`\`json
{
  "findings": [
    {
      "severity": "info",
      "title": "Good setup",
      "detail": "Everything looks correct",
      "remediation": "No action needed"
    }
  ],
  "summary": "Looks good"
}
\`\`\`

That's my analysis.`;
      const result = parseAiResponse(text);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].severity).toBe('info');
      expect(result.summary).toBe('Looks good');
    });

    it('handles empty findings array', () => {
      const json = JSON.stringify({ findings: [], summary: 'All clear' });
      const result = parseAiResponse(json);
      expect(result.findings).toHaveLength(0);
      expect(result.summary).toBe('All clear');
    });

    it('defaults invalid severity to info', () => {
      const json = JSON.stringify({
        findings: [{ severity: 'critical', title: 'Test', detail: 'Test', remediation: 'Test' }],
        summary: '',
      });
      const result = parseAiResponse(json);
      expect(result.findings[0].severity).toBe('info');
    });

    it('handles malformed JSON gracefully', () => {
      const result = parseAiResponse('This is not JSON at all');
      expect(result.findings).toHaveLength(0);
      expect(result.summary).toBe('This is not JSON at all');
    });

    it('extracts JSON from mixed text', () => {
      const text = `Let me analyze this.
{"findings": [{"severity": "error", "title": "Bad", "detail": "Very bad", "remediation": "Fix it"}], "summary": "Issues found"}
Hope this helps.`;
      const result = parseAiResponse(text);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].title).toBe('Bad');
    });

    it('handles missing optional filePath', () => {
      const json = JSON.stringify({
        findings: [{ severity: 'warning', title: 'T', detail: 'D', remediation: 'R' }],
        summary: '',
      });
      const result = parseAiResponse(json);
      expect(result.findings[0].filePath).toBeUndefined();
    });

    it('truncates very long fallback summary', () => {
      const longText = 'x'.repeat(1000);
      const result = parseAiResponse(longText);
      expect(result.summary.length).toBeLessThanOrEqual(500);
    });
  });

  describe('buildDoctorPrompt', () => {
    const baseContext: AnalysisContext = {
      language: { name: 'JavaScript/TypeScript', manifestFile: 'package.json' },
      framework: { name: 'Next.js', version: '14.0.0', variant: 'app-router' },
      sdk: {
        name: '@workos/authkit-nextjs',
        version: '1.0.0',
        latest: '1.0.0',
        outdated: false,
        isAuthKit: true,
        language: 'javascript',
      },
      environment: {
        apiKeyConfigured: true,
        apiKeyType: 'staging',
        clientId: 'client_01J...',
        redirectUri: null,
        cookieDomain: null,
        baseUrl: 'https://api.workos.com',
      },
      existingIssues: [],
    };

    it('includes project context in prompt', () => {
      const prompt = buildDoctorPrompt(baseContext);
      expect(prompt).toContain('JavaScript/TypeScript');
      expect(prompt).toContain('Next.js');
      expect(prompt).toContain('@workos/authkit-nextjs');
      expect(prompt).toContain('staging');
    });

    it('includes existing issues for deduplication', () => {
      const context: AnalysisContext = {
        ...baseContext,
        existingIssues: [{ code: 'MISSING_API_KEY', severity: 'error', message: 'API key not set' }],
      };
      const prompt = buildDoctorPrompt(context);
      expect(prompt).toContain('MISSING_API_KEY');
      expect(prompt).toContain('API key not set');
    });

    it('shows "None detected" when no existing issues', () => {
      const prompt = buildDoctorPrompt(baseContext);
      expect(prompt).toContain('None detected');
    });

    it('handles null framework', () => {
      const context: AnalysisContext = {
        ...baseContext,
        framework: { name: null, version: null },
      };
      const prompt = buildDoctorPrompt(context);
      expect(prompt).not.toContain('Framework:');
    });

    it('handles null SDK', () => {
      const context: AnalysisContext = {
        ...baseContext,
        sdk: { ...baseContext.sdk, name: null, version: null },
      };
      const prompt = buildDoctorPrompt(context);
      expect(prompt).toContain('SDK: Not installed');
    });

    it('includes output format instructions', () => {
      const prompt = buildDoctorPrompt(baseContext);
      expect(prompt).toContain('"findings"');
      expect(prompt).toContain('"summary"');
      expect(prompt).toContain('JSON');
    });

    it('includes SDK knowledge to prevent false positives', () => {
      const prompt = buildDoctorPrompt(baseContext);
      expect(prompt).toContain('SDK Knowledge');
      expect(prompt).toContain('PKCE');
      expect(prompt).toContain('@workos-inc/node');
      expect(prompt).toContain('ANY JavaScript runtime');
    });
  });
});

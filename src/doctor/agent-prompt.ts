import type { LanguageInfo, FrameworkInfo, SdkInfo, EnvironmentInfo, Issue } from './types.js';

export interface AnalysisContext {
  language: LanguageInfo;
  framework: FrameworkInfo;
  sdk: SdkInfo;
  environment: EnvironmentInfo;
  existingIssues: Issue[];
}

export function buildDoctorPrompt(context: AnalysisContext): string {
  const { language, framework, sdk, environment, existingIssues } = context;

  const projectContext = [
    `- Language: ${language.name}`,
    framework.name ? `- Framework: ${framework.name} ${framework.version ?? ''}${framework.variant ? ` (${framework.variant})` : ''}` : null,
    sdk.name ? `- SDK: ${sdk.name}${sdk.version ? ` v${sdk.version}` : ''}` : '- SDK: Not installed',
    `- Environment: ${environment.apiKeyType ?? 'Unknown'}`,
    environment.baseUrl ? `- Base URL: ${environment.baseUrl}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const existingIssuesList =
    existingIssues.length > 0
      ? existingIssues.map((i) => `- [${i.severity}] ${i.code}: ${i.message}`).join('\n')
      : 'None detected.';

  return `You are a WorkOS integration analyst. Analyze this project and identify potential issues with the WorkOS integration.

## Project Context
${projectContext}

## Already Detected Issues
${existingIssuesList}

## Your Task
1. Read key project files to understand the integration
2. Check for framework-specific anti-patterns
3. Verify the integration follows WorkOS best practices
4. Identify potential runtime issues

## Output Format
Return your analysis as a JSON object wrapped in a markdown code block:
\`\`\`json
{
  "findings": [
    {
      "severity": "error | warning | info",
      "title": "Short description",
      "detail": "What's wrong and why it matters",
      "remediation": "How to fix it",
      "filePath": "path/to/relevant/file"
    }
  ],
  "summary": "One paragraph summary of the integration health"
}
\`\`\`

## Rules
- Do NOT repeat issues already detected (listed above)
- Focus on framework-specific patterns the static checks can't catch
- Be specific — reference actual file paths and line patterns you find
- Keep findings actionable — every finding must have a remediation
- Limit to 5-7 most important findings
- If the integration looks good, say so — don't invent problems
- The filePath field is optional — only include it if you found a specific file`;
}

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
    framework.name
      ? `- Framework: ${framework.name} ${framework.version ?? ''}${framework.variant ? ` (${framework.variant})` : ''}`
      : null,
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

## WorkOS SDK Knowledge (IMPORTANT — do not contradict this)
- \`@workos-inc/node\` and \`@workos/node\` work in ANY JavaScript runtime (Node.js, browsers, React Native, Expo, Cloudflare Workers, Deno, Bun). Despite the name, they have NO Node.js-specific API dependencies (no \`node:crypto\`, no \`node:fs\`, etc.).
- \`@workos-inc/node\` supports PKCE (Proof Key for Code Exchange) for client-side authentication flows. Using it in Expo, React Native, or browser SPAs is the CORRECT and recommended approach.
- AuthKit SDKs (\`@workos/authkit-nextjs\`, \`@workos/authkit-react-router\`, \`@workos/authkit-react\`, \`@workos/authkit-tanstack-react-start\`, etc.) are framework-specific wrappers around the core SDK that add session management, middleware, and auth providers.
- Legacy scope \`@workos-inc/*\` and new scope \`@workos/*\` are the same SDKs — the org is migrating package names.
- For non-JS languages: \`workos-python\`, \`workos-ruby\`, \`workos-go\`, \`workos-java\`, \`workos-php\`, \`WorkOS.net\` are server-side SDKs.
- Do NOT flag \`@workos-inc/node\` as incompatible with client-side, mobile, or non-Node environments. It is designed for universal JavaScript use.

## Already Detected Issues
${existingIssuesList}

## Your Task
1. Analyze the project's WorkOS integration based on the context above
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
- Do NOT contradict the SDK Knowledge section above. If you think an SDK is incompatible with a runtime, re-read that section first.
- Only report issues you are confident about. Do NOT speculate about potential problems that might exist — report problems that DO exist based on the project context.
- Focus on framework-specific patterns the static checks can't catch
- Be specific — reference actual file paths and line patterns
- Keep findings actionable — every finding must have a remediation
- Limit to 3-5 most important findings. Fewer high-quality findings beat many speculative ones.
- If the integration looks good, return an empty findings array and say so in the summary. Do NOT invent problems.
- The filePath field is optional — only include it if you found a specific file`;
}

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LanguageInfo, FrameworkInfo, SdkInfo, EnvironmentInfo, Issue } from './types.js';

export interface AnalysisContext {
  installDir: string;
  language: LanguageInfo;
  framework: FrameworkInfo;
  sdk: SdkInfo;
  environment: EnvironmentInfo;
  existingIssues: Issue[];
}

const MAX_FILE_SIZE = 2000;
const README_TIMEOUT_MS = 5000;
const MAX_README_SIZE = 15000;

// Map SDK package names to their GitHub repo README URLs
const SDK_README_URLS: Record<string, string> = {
  '@workos/authkit-nextjs': 'https://raw.githubusercontent.com/workos/authkit-nextjs/main/README.md',
  '@workos-inc/authkit-nextjs': 'https://raw.githubusercontent.com/workos/authkit-nextjs/main/README.md',
  '@workos/authkit-react-router': 'https://raw.githubusercontent.com/workos/authkit-react-router/main/README.md',
  '@workos-inc/authkit-react-router': 'https://raw.githubusercontent.com/workos/authkit-react-router/main/README.md',
  '@workos/authkit-react': 'https://raw.githubusercontent.com/workos/authkit-react/main/README.md',
  '@workos-inc/authkit-react': 'https://raw.githubusercontent.com/workos/authkit-react/main/README.md',
  '@workos/authkit-tanstack-react-start':
    'https://raw.githubusercontent.com/workos/authkit-tanstack-react-start/main/README.md',
  '@workos/authkit-remix': 'https://raw.githubusercontent.com/workos/authkit-remix/main/README.md',
  '@workos-inc/authkit-remix': 'https://raw.githubusercontent.com/workos/authkit-remix/main/README.md',
  '@workos/authkit-sveltekit': 'https://raw.githubusercontent.com/workos/authkit-sveltekit/main/README.md',
  '@workos/authkit-js': 'https://raw.githubusercontent.com/workos/authkit-js/main/README.md',
  '@workos-inc/authkit-js': 'https://raw.githubusercontent.com/workos/authkit-js/main/README.md',
  '@workos-inc/node': 'https://raw.githubusercontent.com/workos/workos-node/main/README.md',
};

async function fetchSdkReadme(sdkName: string | null): Promise<string | null> {
  if (!sdkName) return null;
  const url = SDK_README_URLS[sdkName];
  if (!url) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), README_TIMEOUT_MS);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) return null;
    const text = await response.text();
    return text.length > MAX_README_SIZE ? text.slice(0, MAX_README_SIZE) + '\n... (truncated)' : text;
  } catch {
    return null;
  }
}

function readFileSafe(path: string): string | null {
  try {
    const content = readFileSync(path, 'utf-8');
    return content.length > MAX_FILE_SIZE ? content.slice(0, MAX_FILE_SIZE) + '\n... (truncated)' : content;
  } catch {
    return null;
  }
}

function readEnvFileRedacted(path: string): string | null {
  const content = readFileSafe(path);
  if (!content) return null;
  return content.replace(/^([A-Z_]+)=(.+)$/gm, (_match, key: string, value: string) => {
    if (key.includes('SECRET') || key.includes('PASSWORD') || key.includes('API_KEY')) {
      return `${key}=${value.slice(0, 3)}...(redacted)`;
    }
    return `${key}=${value}`;
  });
}

function collectProjectFiles(installDir: string): string {
  const candidates: string[] = [
    'middleware.ts',
    'middleware.js',
    'proxy.ts',
    'proxy.js',
    'src/middleware.ts',
    'src/middleware.js',
    'src/proxy.ts',
    'src/proxy.js',
    'app/layout.tsx',
    'app/layout.jsx',
    'src/app/layout.tsx',
    'src/app/layout.jsx',
    'app/page.tsx',
    'app/page.jsx',
    'src/app/page.tsx',
    'src/app/page.jsx',
    'src/start.ts',
    'src/start.tsx',
    'app/start.ts',
    'app/root.tsx',
    'app/root.jsx',
    'config/initializers/workos.rb',
    'config/routes.rb',
    'app/settings.py',
    'settings.py',
    'main.go',
    'cmd/main.go',
  ];

  // Callback routes
  for (const prefix of ['app', 'src/app']) {
    for (const path of ['auth/callback', 'callback', 'api/auth/callback']) {
      for (const ext of ['ts', 'tsx', 'js', 'jsx']) {
        candidates.push(`${prefix}/${path}/route.${ext}`);
      }
    }
  }

  const files: string[] = [];
  for (const candidate of candidates) {
    const fullPath = join(installDir, candidate);
    if (existsSync(fullPath)) {
      const content = readFileSafe(fullPath);
      if (content) {
        files.push(`### ${candidate}\n\`\`\`\n${content}\n\`\`\``);
      }
    }
  }

  // Include env files with redacted secrets
  for (const envFile of ['.env.local', '.env']) {
    const fullPath = join(installDir, envFile);
    const content = readEnvFileRedacted(fullPath);
    if (content) {
      files.push(`### ${envFile} (secrets redacted)\n\`\`\`\n${content}\n\`\`\``);
    }
  }

  return files.length > 0 ? files.join('\n\n') : 'No key files found.';
}

export async function buildDoctorPrompt(context: AnalysisContext): Promise<string> {
  const { installDir, language, framework, sdk, environment, existingIssues } = context;

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

  const readme = await fetchSdkReadme(sdk.name);
  const readmeSection = readme
    ? `## SDK Documentation (source of truth)\nThis is the official README for ${sdk.name}. Use it to determine correct patterns, imports, and configuration.\n\n${readme}`
    : '## SDK Documentation\nUnable to fetch SDK README. Be conservative — only report issues you are certain about.';

  return `You are a WorkOS integration analyst. Compare this project's code against the SDK documentation and identify real issues.

## Project Context
${projectContext}

## General SDK Knowledge
- \`@workos-inc/node\` works in ANY JavaScript runtime (Node.js, browsers, React Native, Expo, etc.). Despite the name, it has no Node.js-specific dependencies.
- Some packages are under \`@workos-inc/*\` and some under \`@workos/*\`. Both are official. Do NOT flag package scope as an issue.

${readmeSection}

## Project Files
${collectProjectFiles(installDir)}

## Already Detected Issues
${existingIssuesList}

## Your Task
Compare the project files against the SDK documentation above. Report issues where the code DEVIATES from what the documentation says to do. If the code follows the documented patterns, it is correct.

## Output Format
Return your analysis as a JSON object wrapped in a markdown code block:
\`\`\`json
{
  "findings": [
    {
      "severity": "error | warning | info",
      "title": "Short description",
      "detail": "What's wrong and why it matters",
      "docSays": "Direct quote or paraphrase from the SDK documentation above",
      "codeDoes": "What the project code actually does that contradicts the docs",
      "remediation": "How to fix it",
      "filePath": "path/to/relevant/file"
    }
  ],
  "summary": "One paragraph summary of the integration health"
}
\`\`\`

## Rules
- Every finding MUST have both "docSays" and "codeDoes" filled in. If you cannot cite what the documentation requires AND how the code deviates, it is not a valid finding — drop it.
- "docSays" must reference something the documentation REQUIRES, not something optional or a suggestion.
- "codeDoes" must show an actual contradiction, not "the code doesn't use an optional feature."
- If the code matches the documented patterns, it is CORRECT. Do not suggest alternatives, improvements, or optional features.
- Do NOT report issues about optional configuration, missing optional callbacks, or "consider adding" suggestions.
- Do NOT repeat issues already detected (listed above).
- Do NOT invent SDK options, config properties, or API methods not in the documentation.
- Do NOT flag package scope (@workos-inc/* vs @workos/*) as an issue.
- A well-configured project should have ZERO findings — return an empty findings array and a positive summary.`;
}

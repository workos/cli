import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

/**
 * Generate a concise commit message for the AuthKit integration.
 * Falls back to a default message if AI generation fails.
 */
export async function generateCommitMessage(integration: string, files: string[]): Promise<string> {
  try {
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
  } catch {
    // Fall through to default
  }

  return `feat: add WorkOS AuthKit integration for ${integration}`;
}

/**
 * Generate a PR description for the AuthKit integration.
 * Falls back to a default template if AI generation fails.
 */
export async function generatePrDescription(
  integration: string,
  files: string[],
  commitMessage: string,
): Promise<string> {
  try {
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
  } catch {
    // Fall through to default
  }

  return `## Summary
Added WorkOS AuthKit integration for ${integration}.

## Changes
${files.map((f) => `- ${f}`).join('\n')}

## Documentation
https://workos.com/docs/user-management`;
}

import { extractFromBunfs } from '@anthropic-ai/claude-agent-sdk/extract';
import { EMBEDDED_CLAUDE_PATH } from './embedded-assets.js';

/**
 * Resolve the path to the Claude Code native binary the Agent SDK should spawn.
 * In a compiled binary the embedded path is inside Bun's read-only virtual
 * filesystem, which child processes cannot exec; the SDK's `extractFromBunfs`
 * helper copies it to a real temp path (content-hash-addressed, atomic,
 * concurrency-safe). In dev EMBEDDED_CLAUDE_PATH is null and the SDK resolves
 * the binary from node_modules itself.
 *
 * This is the ONLY runtime extraction. Skill content is consumed from the
 * embedded map in-memory (skills.ts) or written directly to install targets
 * (commands/install-skill.ts).
 */
export async function resolveEmbeddedClaude(): Promise<string | null> {
  if (!EMBEDDED_CLAUDE_PATH) {
    return null;
  }
  return extractFromBunfs(EMBEDDED_CLAUDE_PATH);
}

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { extractFromBunfs } from '@anthropic-ai/claude-agent-sdk/extract';
import { EMBEDDED_CLAUDE_PATH, EMBEDDED_SKILLS, EMBEDDED_SKILLS_VERSION } from './embedded-assets.js';

/**
 * Write an embedded file map (relative path -> base64 contents) out to a
 * version-namespaced directory and return the WorkOS skills plugin path the
 * Agent SDK should load. Idempotent via an extraction marker.
 *
 * @returns the absolute path to `<version>/plugins/workos`.
 */
export async function materializeSkills(
  files: Record<string, string>,
  version: string,
  baseDir: string,
): Promise<string> {
  const versionDir = join(baseDir, version);
  const pluginPath = join(versionDir, 'plugins', 'workos');
  const marker = join(versionDir, '.extracted');

  try {
    await stat(marker);
    return pluginPath;
  } catch {
    // not extracted yet
  }

  for (const [relPath, base64] of Object.entries(files)) {
    const dest = join(versionDir, relPath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(base64, 'base64'));
  }

  await writeFile(marker, version);
  return pluginPath;
}

function runtimeBaseDir(): string {
  return join(homedir(), '.workos', 'runtime');
}

/**
 * Resolve the path to the Claude Code native binary the Agent SDK should spawn.
 * In a compiled binary the embedded path is inside Bun's read-only virtual
 * filesystem, which child processes cannot exec; the SDK's `extractFromBunfs`
 * helper copies it to a real temp path (content-hash-addressed, atomic,
 * concurrency-safe). In dev EMBEDDED_CLAUDE_PATH is null and the SDK resolves
 * the binary from node_modules itself.
 */
export async function resolveEmbeddedClaude(): Promise<string | null> {
  if (!EMBEDDED_CLAUDE_PATH) {
    return null;
  }
  return extractFromBunfs(EMBEDDED_CLAUDE_PATH);
}

/**
 * Resolve the WorkOS skills plugin path for the Agent SDK. Returns the extracted
 * on-disk plugin path when running as a compiled binary, or null in dev (use the
 * node_modules @workos/skills location). The SDK's extract helper only covers a
 * single file, so the skills *directory* is still materialized by hand.
 */
export async function resolveEmbeddedSkillsPlugin(): Promise<string | null> {
  if (!EMBEDDED_SKILLS || !EMBEDDED_SKILLS_VERSION) {
    return null;
  }
  return materializeSkills(EMBEDDED_SKILLS, EMBEDDED_SKILLS_VERSION, join(runtimeBaseDir(), 'skills'));
}

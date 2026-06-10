import { getReference as packageGetReference } from '@workos/skills';
import { EMBEDDED_SKILLS } from './embedded-assets.js';

/**
 * Map key for a workos skill reference inside the embedded skills map.
 * Mirrors the @workos/skills package layout used by scripts/build-binary.ts
 * (`plugins/workos/skills/workos/references/<name>.md`).
 */
function embeddedReferenceKey(name: string): string {
  return `plugins/workos/skills/workos/references/${name}.md`;
}

/**
 * Decode a skills reference from an embedded file map (relative path ->
 * base64 contents). Pure in-memory lookup — no filesystem involved.
 */
export function referenceFromEmbedded(files: Record<string, string>, name: string): string {
  const base64 = files[embeddedReferenceKey(name)];
  if (base64 === undefined) {
    throw new Error(`Reference "${name}" not found in embedded skills`);
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Read a skills reference by name. In a compiled binary the content comes
 * straight from the embedded skills map (zero extraction); in dev it resolves
 * from the @workos/skills package in node_modules.
 */
export async function getReference(name: string): Promise<string> {
  if (EMBEDDED_SKILLS) {
    return referenceFromEmbedded(EMBEDDED_SKILLS, name);
  }
  return packageGetReference(name);
}

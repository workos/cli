import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getReference as realGetReference } from '@workos/skills';
import { resolveEmbeddedSkillsPlugin } from './runtime.js';

/**
 * Path to a skills reference markdown file inside an (extracted) skills plugin
 * directory. Mirrors the on-disk layout @workos/skills uses
 * (`<plugin>/skills/workos/references/<name>.md`).
 */
export function embeddedReferencePath(pluginPath: string, name: string): string {
  return join(pluginPath, 'skills', 'workos', 'references', `${name}.md`);
}

/**
 * Read a skills reference by name. In a compiled binary the @workos/skills data
 * files are not on disk, so read from the extracted plugin directory; in dev fall
 * back to the package's own resolver.
 */
export async function getReference(name: string): Promise<string> {
  const pluginPath = await resolveEmbeddedSkillsPlugin();
  if (!pluginPath) {
    return realGetReference(name);
  }
  return readFile(embeddedReferencePath(pluginPath, name), 'utf-8');
}

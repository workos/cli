/**
 * The full-screen installer's content: task labels, walkthrough copy, tips,
 * and announcements. Edit `installer-content.json` to change any of it; see
 * README.md in this directory.
 */

import bundled from './installer-content.json' with { type: 'json' };
import { parseInstallerContent, type InstallerContent } from './schema.js';

let cached: InstallerContent | undefined;

/** The bundled content, validated on first use. */
export function loadInstallerContent(): InstallerContent {
  cached ??= parseInstallerContent(bundled);
  return cached;
}

export * from './schema.js';
export * from './select.js';

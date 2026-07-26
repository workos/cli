import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BUNDLED_SKILLS_VERSION, skillsAssets } from '../generated/skills-manifest.js';

let cachedSkillsDir: string | undefined;

// Only reap extraction roots older than this: a fresh one may belong to a
// concurrently running older/newer CLI mid-install.
const STALE_ROOT_MS = 24 * 60 * 60 * 1000;

function extractionSuffix(): string {
  return process.platform === 'win32' ? '' : `-${process.getuid?.() ?? 0}`;
}

function safeExtractionRoot(): string {
  const root = join(tmpdir(), `workos-skills-${BUNDLED_SKILLS_VERSION}${extractionSuffix()}`);

  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (typeof process.getuid === 'function') {
    const info = lstatSync(root);
    if (!info.isDirectory()) {
      throw new Error(`Skills temp path ${root} is not a directory; refusing to use it`);
    }
    const uid = process.getuid();
    if (info.uid !== uid) {
      throw new Error(`Skills temp directory ${root} is owned by uid ${info.uid}, expected ${uid}`);
    }
    if ((info.mode & 0o777) !== 0o700) chmodSync(root, 0o700);
  }

  return root;
}

function materializeFile(target: string, embedded: string, mode: number): void {
  const contents = readFileSync(embedded);
  if (existsSync(target)) {
    try {
      if (readFileSync(target).equals(contents)) {
        chmodSync(target, mode);
        return;
      }
    } catch {
      // Replace unreadable or incomplete files below.
    }
  }

  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp.${process.pid}.${randomUUID()}`;
  try {
    writeFileSync(temporary, contents, { mode });
    chmodSync(temporary, mode);
    renameSync(temporary, target);
  } catch (error) {
    // A concurrent process may have won the extraction race. Only accept its
    // output when it is byte-identical to the embedded asset.
    if (existsSync(target)) {
      try {
        if (readFileSync(target).equals(contents)) {
          rmSync(temporary, { force: true });
          chmodSync(target, mode);
          return;
        }
      } catch {
        // Re-throw the original extraction failure below.
      }
    }
    rmSync(temporary, { force: true });
    throw error;
  }
}

/**
 * Best-effort reap of extraction roots left behind by other CLI versions —
 * each version keys its own `workos-skills-<version>` tree, which would
 * otherwise accumulate in tmp forever. Never interferes with the current run.
 */
function cleanupStaleExtractionRoots(currentRoot: string): void {
  const suffix = extractionSuffix();
  let entries: string[];
  try {
    entries = readdirSync(tmpdir());
  } catch {
    return;
  }

  const cutoff = Date.now() - STALE_ROOT_MS;
  for (const entry of entries) {
    if (!entry.startsWith('workos-skills-')) continue;
    if (suffix && !entry.endsWith(suffix)) continue;
    const path = join(tmpdir(), entry);
    if (path === currentRoot) continue;
    try {
      if (lstatSync(path).mtimeMs < cutoff) {
        rmSync(path, { recursive: true, force: true });
      }
    } catch {
      // Owned by someone else, already gone, or mid-removal — skip it.
    }
  }
}

/** Extract the bundled plugin assets to a real directory and return its skills directory. */
export function materializeSkillsDir(): string {
  if (cachedSkillsDir) return cachedSkillsDir;

  const root = safeExtractionRoot();
  const pluginsRoot = join(root, 'plugins');
  for (const asset of skillsAssets) {
    materializeFile(join(pluginsRoot, ...asset.relPath.split('/')), asset.embedded, asset.executable ? 0o755 : 0o644);
  }

  cleanupStaleExtractionRoots(root);

  cachedSkillsDir = join(pluginsRoot, 'workos', 'skills');
  return cachedSkillsDir;
}

export function getSkillsDir(): string {
  return materializeSkillsDir();
}

export function getReferencePath(name: string): string {
  return join(getSkillsDir(), 'workos', 'references', `${name}.md`);
}

export async function getReference(name: string): Promise<string> {
  return readFile(getReferencePath(name), 'utf8');
}

export function getSkillPath(skillName: string): string {
  return join(getSkillsDir(), skillName, 'SKILL.md');
}

export async function getSkill(skillName: string): Promise<string> {
  return readFile(getSkillPath(skillName), 'utf8');
}

export { BUNDLED_SKILLS_VERSION };

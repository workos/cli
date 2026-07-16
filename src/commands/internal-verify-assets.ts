import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { AGENT_SDK_TARGET, AGENT_SDK_VERSION, ensureClaudeCodeExecutable } from '../lib/agent-sdk-assets.js';
import { BUNDLED_SKILLS_VERSION, getSkillsDir } from '../lib/skills-assets.js';
import { logError } from '../utils/debug.js';
import { exitWithError, isJsonMode, outputJson } from '../utils/output.js';
import { discoverSkills } from './install-skill.js';

// Generous timeout: on Windows the first spawn of a freshly-installed
// executable can stall behind a Defender scan.
const CLAUDE_SPAWN_TIMEOUT_MS = 120_000;

/**
 * CI/diagnostic command (hidden): prove that the runtime assets work on this
 * machine — skills embedded in the compiled binary materialize and are
 * readable, and the pinned Agent SDK `claude` executable resolves (first-run
 * download + checksum verification from a compiled binary; node_modules in
 * dev) and actually runs. Exits non-zero on the first failure so release
 * pipelines can gate on it. Requires network access from a compiled binary
 * unless the download is already cached.
 */
export async function runVerifyAssets(): Promise<void> {
  let skillsDir: string;
  let skills: string[];
  try {
    skillsDir = getSkillsDir();
    skills = await discoverSkills(skillsDir);
    if (skills.length === 0) {
      throw new Error(`no skills found under ${skillsDir}`);
    }
    // Read one SKILL.md end-to-end to prove the materialized content is usable.
    readFileSync(join(skillsDir, skills[0], 'SKILL.md'), 'utf8');
  } catch (error) {
    logError('Embedded skills verification failed:', error);
    exitWithError({
      code: 'VERIFY_ASSETS_SKILLS_FAILED',
      message: `Embedded skills failed to materialize: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // The keyring native binding is load-bearing: config-store.ts imports it
  // statically, so a binary compiled without the target's .node binding
  // crashes at startup instead of falling back to file storage. The import is
  // where the binding dlopens — success proves it embedded and loaded. Entry
  // construction/reads exercise the OS storage layer, which is environmental
  // (Docker seccomp blocks kernel keyutils; headless CI has no secret
  // service) — a failure there still proves the binding and must not fail
  // verification.
  let keyring: 'native' | 'native-storage-unavailable';
  try {
    const { Entry } = await import('@napi-rs/keyring');
    try {
      new Entry('workos-cli', 'verify-assets-probe').getPassword();
      keyring = 'native';
    } catch {
      keyring = 'native-storage-unavailable';
    }
  } catch (error) {
    logError('Keyring binding verification failed:', error);
    exitWithError({
      code: 'VERIFY_ASSETS_KEYRING_FAILED',
      message: `Keyring native binding failed to load: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  let claudePath: string;
  let claudeVersion: string;
  try {
    claudePath = await ensureClaudeCodeExecutable();
    const result = spawnSync(claudePath, ['--version'], { encoding: 'utf8', timeout: CLAUDE_SPAWN_TIMEOUT_MS });
    if (result.error) throw result.error;
    if (result.status !== 0 || !result.stdout.trim()) {
      throw new Error(`claude --version exited with status ${result.status}: ${result.stderr?.trim() || 'no output'}`);
    }
    claudeVersion = result.stdout.trim();
  } catch (error) {
    logError('Agent SDK verification failed:', error);
    exitWithError({
      code: 'VERIFY_ASSETS_AGENT_SDK_FAILED',
      message: `Agent SDK executable failed to resolve or run: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  const report = {
    ok: true,
    skillsDir,
    skillCount: skills.length,
    bundledSkillsVersion: BUNDLED_SKILLS_VERSION,
    keyring,
    claudePath,
    claudeVersion,
    agentSdkTarget: AGENT_SDK_TARGET,
    agentSdkVersion: AGENT_SDK_VERSION,
  };

  if (isJsonMode()) {
    outputJson(report);
    return;
  }

  console.log(chalk.green('✓'), `Skills materialized: ${skills.length} skills at ${skillsDir}`);
  console.log(chalk.green('✓'), `Keyring binding loaded (${keyring})`);
  console.log(chalk.green('✓'), `Agent SDK ${AGENT_SDK_VERSION} (${AGENT_SDK_TARGET}) at ${claudePath}`);
  console.log(chalk.green('✓'), `claude --version → ${claudeVersion} (pinned SDK ${AGENT_SDK_VERSION})`);
}

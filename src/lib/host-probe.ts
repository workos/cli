/**
 * Host capability probes for non-interactive / sandboxed environments.
 *
 * When the CLI runs inside an AI agent sandbox (Claude Code, Codex, Cursor),
 * the keyring, home directory, network, or browser may be unavailable.
 * These helpers detect that situation and emit a single actionable warning
 * per session instead of letting opaque EPERM errors confuse the agent.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Entry } from '@napi-rs/keyring';
import { isNonInteractiveEnvironment } from '../utils/environment.js';
import { logWarn, logInfo } from '../utils/debug.js';

export type HostCapability = 'home-fs' | 'keychain' | 'network' | 'browser-launch';

export interface ProbeFailure {
  capability: HostCapability;
  detail: string;
}

export interface ProbeResult {
  ok: boolean;
  failures: ProbeFailure[];
}

let warnedThisSession = false;
let cachedProbe: ProbeResult | undefined;

const PERMISSION_PATTERNS = [
  /\bEPERM\b/i,
  /\bEACCES\b/i,
  /operation not permitted/i,
  /permission denied/i,
  /\bsandboxd?\b/i,
  /interaction is not allowed/i,
  /access denied/i,
];

function isPermissionError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return PERMISSION_PATTERNS.some((p) => p.test(msg));
}

function isMissingEntryError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('not found') || msg.includes('No such');
}

async function probeHomeFs(): Promise<ProbeFailure | null> {
  const dir = path.join(os.homedir(), '.workos');
  const probePath = path.join(dir, `.probe-${process.pid}-${crypto.randomUUID()}`);

  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(probePath, new Date().toISOString(), { mode: 0o600 });
    await fs.unlink(probePath);
    return null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { capability: 'home-fs', detail };
  }
}

function probeKeychain(): ProbeFailure | null {
  try {
    const entry = new Entry('workos-cli', 'probe');
    entry.getPassword();
    return null;
  } catch (error) {
    // A "not found" / "No such" error means the keychain is reachable but the
    // probe entry simply doesn't exist — that's a healthy state, not a failure.
    if (isMissingEntryError(error)) {
      return null;
    }
    const detail = error instanceof Error ? error.message : String(error);
    return { capability: 'keychain', detail };
  }
}

export async function runHostProbe(): Promise<ProbeResult> {
  if (cachedProbe) return cachedProbe;

  const failures: ProbeFailure[] = [];

  const fsResult = await probeHomeFs();
  if (fsResult) failures.push(fsResult);

  const keychainResult = probeKeychain();
  if (keychainResult) failures.push(keychainResult);

  cachedProbe = { ok: failures.length === 0, failures };
  return cachedProbe;
}

export async function warnIfSandboxed(): Promise<void> {
  if (warnedThisSession) return;
  if (!isNonInteractiveEnvironment()) return;

  const probe = await runHostProbe();
  if (probe.ok) return;

  warnedThisSession = true;

  const caps = probe.failures.map((f) => f.capability).join(', ');
  logWarn(
    `Host capabilities may be unavailable (${caps}). This may be a sandboxed environment.`,
    'Re-run this command on the host shell before trusting auth or API failures.',
  );

  for (const f of probe.failures) {
    logInfo(`[host-probe] ${f.capability}: ${f.detail}`);
  }
}

export function observeHostFailure(capability: HostCapability, error: unknown): void {
  if (warnedThisSession) return;
  if (!isNonInteractiveEnvironment()) return;
  if (!isPermissionError(error)) return;

  warnedThisSession = true;

  const detail = error instanceof Error ? error.message : String(error);
  logWarn(
    `Host capability "${capability}" failed (${detail}). This may be a sandboxed environment.`,
    'Re-run this command on the host shell before trusting auth or API failures.',
  );
}

export function _resetProbeState(): void {
  cachedProbe = undefined;
  warnedThisSession = false;
}

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
import { isAgentMode, isCiMode } from '../utils/interaction-mode.js';
import { logInfo, logVisibleWarn } from '../utils/debug.js';

export type HostCapability = 'home-fs' | 'keychain' | 'network' | 'browser-launch' | 'localhost-bind';
export type HostOperation = 'read' | 'write' | 'delete' | 'connect' | 'open' | 'listen';

export interface HostCapabilityDetails {
  operation?: HostOperation;
  target?: string;
  label?: string;
}

export interface ProbeFailure extends HostCapabilityDetails {
  capability: HostCapability;
  detail: string;
}

export interface ProbeResult {
  ok: boolean;
  failures: ProbeFailure[];
}

let warnedThisSession = false;
let cachedProbe: ProbeResult | undefined;

const KEYCHAIN_SERVICE = 'workos-cli';
const KEYCHAIN_PROBE_ACCOUNT = 'probe';

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

function isLikelyHostFailure(capability: HostCapability, error: unknown): boolean {
  if (capability === 'browser-launch' || capability === 'localhost-bind') {
    return true;
  }

  return isPermissionError(error);
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
    return null;
  } catch (error) {
    // Only treat permission-class errors as sandbox indicators. Transient
    // errors like ENOSPC/EIO would otherwise produce a misleading "sandboxed
    // environment" warning. Mirrors the gating in observeHostFailure().
    if (!isPermissionError(error)) return null;
    const detail = error instanceof Error ? error.message : String(error);
    return { capability: 'home-fs', detail, operation: 'write', target: dir, label: 'WorkOS home directory' };
  } finally {
    // Best-effort cleanup so a successful write never leaves an orphan file
    // behind. Ignore unlink failures: if the file was never created the
    // unlink will fail with ENOENT, and any other failure is unrelated to
    // the probe's purpose (which is checking write access, not delete).
    await fs.unlink(probePath).catch(() => {});
  }
}

function probeKeychain(): ProbeFailure | null {
  try {
    const entry = new Entry(KEYCHAIN_SERVICE, KEYCHAIN_PROBE_ACCOUNT);
    entry.getPassword();
    return null;
  } catch (error) {
    // A "not found" / "No such" error means the keychain is reachable but the
    // probe entry simply doesn't exist — that's a healthy state, not a failure.
    if (isMissingEntryError(error)) {
      return null;
    }
    // Only treat permission-class errors as sandbox indicators. A user-canceled
    // macOS prompt or a transient keyring daemon hiccup would otherwise produce
    // a misleading "sandboxed environment" warning. Mirrors probeHomeFs() and
    // observeHostFailure().
    if (!isPermissionError(error)) return null;
    const detail = error instanceof Error ? error.message : String(error);
    return {
      capability: 'keychain',
      detail,
      operation: 'read',
      target: `${KEYCHAIN_SERVICE}/${KEYCHAIN_PROBE_ACCOUNT}`,
      label: 'WorkOS keychain probe',
    };
  }
}

export function formatHostProbeFailure(failure: ProbeFailure): string {
  const parts = [failure.label ?? failure.capability];
  if (failure.operation) parts.push(`operation=${failure.operation}`);
  if (failure.target) parts.push(`target=${failure.target}`);
  parts.push(`error=${failure.detail}`);
  return parts.join(', ');
}

function formatHostFailureContext(capability: HostCapability, details: HostCapabilityDetails, detail: string): string {
  return formatHostProbeFailure({ capability, ...details, detail });
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

function shouldWarnForHostTrust(): boolean {
  return isAgentMode() || isCiMode();
}

export async function warnIfSandboxed(): Promise<void> {
  if (warnedThisSession) return;
  if (!shouldWarnForHostTrust()) return;

  const probe = await runHostProbe();
  if (probe.ok) return;

  warnedThisSession = true;

  const caps = probe.failures.map((f) => f.capability).join(', ');
  logVisibleWarn(
    `Host capabilities may be unavailable (${caps}). This may be a sandboxed environment.`,
    'Re-run this command on the host shell before trusting auth or API failures.',
  );

  for (const f of probe.failures) {
    logInfo(`[host-probe] ${formatHostProbeFailure(f)}`);
  }
}

export function observeHostFailure(
  capability: HostCapability,
  error: unknown,
  details: HostCapabilityDetails = {},
): void {
  if (warnedThisSession) return;
  if (!shouldWarnForHostTrust()) return;
  if (!isLikelyHostFailure(capability, error)) return;

  warnedThisSession = true;

  const detail = error instanceof Error ? error.message : String(error);
  logVisibleWarn(
    `Host capability "${capability}" failed (${detail}). This may be a sandboxed environment.`,
    'Re-run this command on the host shell before trusting auth or API failures.',
  );
  logInfo(`[host-probe] ${formatHostFailureContext(capability, details, detail)}`);
}

export function _resetProbeState(): void {
  cachedProbe = undefined;
  warnedThisSession = false;
}

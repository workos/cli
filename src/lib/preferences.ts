/**
 * Plain CLI preferences store.
 *
 * Stored at ~/.workos/preferences.json as plain JSON. These are NOT secrets —
 * knowing that someone opted out of telemetry leaks nothing — so this
 * deliberately avoids the keyring abstraction (config-store.ts) to prevent a
 * non-secret write from ever triggering the insecure-fallback security warning.
 *
 * Mirrors the structural pattern of device-id.ts: a synchronous accessor backed
 * by a cache, an async prewarm that populates that cache off the blocking-fs
 * path, and a never-throws contract on every read/parse so a corrupt file can
 * never break a command.
 */

import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export interface CliPreferences {
  telemetry?: {
    /** true => the user explicitly opted out of telemetry. */
    optedOut?: boolean;
    /** ISO timestamp the first-run notice was shown — written in Phase 2 only. */
    noticeShownAt?: string;
  };
  /**
   * Legacy MCP-install onboarding state. The MCP offer folded into `setup` (see
   * commands/setup.ts); these fields are retained for back-compat so a user who
   * declined the old standalone MCP offer is still treated as setup-declined
   * (see isSetupDeclined). Kept in this plain-JSON store alongside telemetry.
   */
  mcp?: {
    /**
     * true => the user explicitly declined an automatic MCP install offer. The
     * decline is absolute: no automatic surface (prompt or banner) asks again;
     * `workos mcp install` stays available manually.
     */
    promptDeclined?: boolean;
    /** ISO timestamp the one-time MCP banner was shown. */
    bannerShownAt?: string;
  };
  /**
   * Consolidated agent-setup onboarding state (skills + MCP). Owned by
   * commands/setup.ts. `declined` is absolute for the automatic surfaces
   * (post-login / post-install); `workos setup` stays available manually.
   * Legacy `mcp.promptDeclined` is treated as an implicit setup-decline on read
   * (see isSetupDeclined) so users who already declined MCP are never re-asked.
   */
  setup?: {
    declined?: boolean;
    /** ISO timestamp the user completed a setup run. */
    completedAt?: string;
  };
}

/** Effective source of the resolved telemetry-enabled decision. */
export type TelemetrySource = 'env' | 'preference' | 'default';

let cached: CliPreferences | undefined;
let pending: Promise<CliPreferences> | undefined;

export function getPreferencesPath(): string {
  return path.join(os.homedir(), '.workos', 'preferences.json');
}

function parsePreferences(raw: string): CliPreferences {
  try {
    const value = JSON.parse(raw);
    // Defend against a file that parses to a non-object (e.g. `"true"`, `42`).
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as CliPreferences;
    }
  } catch {
    // Corrupt JSON — fall through to empty preferences. A later savePreferences
    // overwrites it cleanly; we never auto-delete.
  }
  return {};
}

/**
 * Asynchronously load preferences and warm the cache the synchronous
 * getPreferences() reads. Memoized: the first call performs the IO, concurrent
 * and later callers await the same promise. Prewarming this at startup keeps
 * the synchronous telemetry path off blocking fs IO. Never rejects.
 */
export function loadPreferences(): Promise<CliPreferences> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;

  pending = (async () => {
    try {
      const raw = await readFile(getPreferencesPath(), 'utf8');
      cached = parsePreferences(raw);
    } catch {
      // Missing/unreadable file — treat as no preferences set.
      cached = {};
    } finally {
      pending = undefined;
    }
    return cached;
  })();

  return pending;
}

/**
 * Synchronous accessor. Returns the prewarmed value when loadPreferences() has
 * run; otherwise performs a one-time synchronous read of the same file. On any
 * IO/parse failure returns {} (telemetry stays at its default-on state). Never
 * throws.
 */
export function getPreferences(): CliPreferences {
  if (cached) return cached;

  try {
    const raw = fs.readFileSync(getPreferencesPath(), 'utf8');
    cached = parsePreferences(raw);
  } catch {
    // Missing/unreadable/corrupt — telemetry stays at its default-on state.
    cached = {};
  }
  return cached;
}

/**
 * Read-modify-write the on-disk preferences, merging `next` over the current
 * persisted value so future fields are never clobbered, then update the cache.
 * Throws on write failure so callers on the command path (opt-out/opt-in) can
 * surface a clear error — the read path swallows, the write path does not.
 */
export function savePreferences(next: CliPreferences): void {
  const filePath = getPreferencesPath();

  // Read-modify-write over the CURRENT on-disk value (not the cache) so a field
  // written by another process / a future phase is preserved.
  let current: CliPreferences = {};
  try {
    current = parsePreferences(fs.readFileSync(filePath, 'utf8'));
  } catch {
    // No existing file (or unreadable) — start from empty.
  }

  // Shallow-merge each known nested group (one level) so writing one field
  // (e.g. setup.completedAt) never clobbers a sibling written at a different
  // time (e.g. setup.declined). A new nested group is one entry in this list.
  const merged: CliPreferences = { ...current, ...next };
  for (const key of ['telemetry', 'mcp', 'setup'] as const) {
    if (current[key] || next[key]) {
      Object.assign(merged, { [key]: { ...current[key], ...next[key] } });
    }
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, JSON.stringify(merged), { encoding: 'utf8', mode: 0o600 });
  cached = merged;
}

/** Whether the user has explicitly opted out via the saved preference. */
export function isTelemetryOptedOut(): boolean {
  return getPreferences().telemetry?.optedOut === true;
}

/** Persist the opt-out flag. Throws on write failure (see savePreferences). */
export function setTelemetryOptedOut(value: boolean): void {
  savePreferences({ telemetry: { optedOut: value } });
}

/** Whether the first-run telemetry notice has already been shown (ever). */
export function isNoticeShown(): boolean {
  return !!getPreferences().telemetry?.noticeShownAt;
}

/**
 * Persist the first-run notice as shown, stamping the current time. Uses the
 * read-modify-write savePreferences so it never clobbers the optedOut flag.
 * Throws on write failure (see savePreferences) — the caller in
 * telemetry-notice.ts swallows it so a read-only FS never blocks a command.
 */
export function markNoticeShown(): void {
  savePreferences({ telemetry: { noticeShownAt: new Date().toISOString() } });
}

/**
 * Whether an automatic setup offer should be suppressed. Absolute once the user
 * declines. Treats the legacy `mcp.promptDeclined` flag as an implicit decline
 * so anyone who declined the old MCP offer is never re-prompted by the new flow.
 */
export function isSetupDeclined(): boolean {
  const prefs = getPreferences();
  return prefs.setup?.declined === true || prefs.mcp?.promptDeclined === true;
}

/** Whether the user has completed a setup run (ever). */
export function isSetupCompleted(): boolean {
  return !!getPreferences().setup?.completedAt;
}

/** Persist an explicit setup decline. Throws on write failure (see savePreferences). */
export function recordSetupDeclined(): void {
  savePreferences({ setup: { declined: true } });
}

/** Persist a completed setup run, stamping the current time. */
export function recordSetupCompleted(): void {
  savePreferences({ setup: { completedAt: new Date().toISOString() } });
}

/** Clear the setup decline (new + legacy) so automatic offers resume. For `workos setup --reset`. */
export function clearSetupDecline(): void {
  savePreferences({ setup: { declined: false }, mcp: { promptDeclined: false } });
}

/**
 * Tri-state env override for telemetry.
 *
 * Only the explicit strings 'true' / 'false' count as an override. Any other
 * value — including unset or garbage like '1' — returns undefined and falls
 * through to the saved preference.
 *
 * This is a deliberate, documented change from the old `WORKOS_TELEMETRY !==
 * 'false'` behaviour: previously `WORKOS_TELEMETRY=1` forced telemetry on even
 * for opted-out users; now an opt-out is respected unless the env var
 * explicitly says 'true'.
 */
export function envTelemetryOverride(): boolean | undefined {
  const value = process.env.WORKOS_TELEMETRY;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/**
 * Effective telemetry-enabled decision.
 *
 * Resolution order:
 *   1. envTelemetryOverride() if defined — env wins in BOTH directions.
 *   2. otherwise !isTelemetryOptedOut() — default-on unless explicitly opted out.
 */
export function isTelemetryEnabled(): boolean {
  const override = envTelemetryOverride();
  if (override !== undefined) return override;
  return !isTelemetryOptedOut();
}

/**
 * Which signal produced the effective telemetry decision. Mirrors the
 * precedence in isTelemetryEnabled() so the `telemetry status` command and the
 * resolver can never drift.
 *
 * Note: an explicit opt-in (optedOut === false) reads as 'default', not
 * 'preference' — its outcome is identical to a fresh install, and the resolver
 * only treats optedOut === true as a non-default signal, so reporting
 * 'preference' here would imply a behavioral difference that does not exist.
 */
export function getTelemetrySource(): TelemetrySource {
  if (envTelemetryOverride() !== undefined) return 'env';
  if (isTelemetryOptedOut()) return 'preference';
  return 'default';
}

/**
 * Delete the preferences file, returning telemetry to its fresh-install state
 * (opted-in, first-run notice unseen). Used by `debug reset` to wipe stored CLI
 * state alongside credentials and config. No-op if the file does not exist;
 * throws on a real delete failure (e.g. permission denied) so the caller can
 * surface it, mirroring clearConfig/clearCredentials. Resets the in-memory
 * cache so subsequent reads in this process reflect the cleared state.
 */
export function clearPreferences(): void {
  fs.rmSync(getPreferencesPath(), { force: true });
  cached = {};
  pending = undefined;
}

/** Test seam — resets the in-memory cache between test cases. */
export function __resetPreferencesCache(): void {
  cached = undefined;
  pending = undefined;
}

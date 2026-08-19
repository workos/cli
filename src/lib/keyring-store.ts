/**
 * Shared machinery for keychain-backed stores with file fallback
 * (credential-store and config-store).
 *
 * Behavior per store instance:
 * - Backend: @napi-rs/keyring everywhere except macOS, which routes through
 *   /usr/bin/security so keychain trust survives across ad-hoc-signed
 *   releases (see darwin-keychain.ts).
 * - In-process cache: values are read from many call sites per run; each
 *   uncached keyring read is a separate keychain ACL check — one password
 *   dialog per read on an untrusted binary. First read is cached; saves keep
 *   it coherent.
 * - File fallback with a one-time warning when the keyring is unavailable,
 *   and one-shot migration of file contents back into the keyring.
 */

import { Entry } from '@napi-rs/keyring';
import { DarwinSecurityEntry } from './darwin-keychain.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logWarn } from '../utils/debug.js';
import { observeHostFailure } from './host-probe.js';

interface KeyringEntryLike {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): void;
}

export interface KeyringStoreOptions<T> {
  serviceName: string;
  accountName: string;
  /** Fallback file name under ~/.workos, e.g. 'credentials.json'. */
  fileName: string;
  /** Human noun for log messages and host-probe labels, e.g. 'credentials'. */
  label: string;
  /**
   * Validate/narrow a parsed blob; return null to treat as absent (a
   * malformed blob must read as logged-out/unset, not crash callers).
   * Default: accept as-is.
   */
  validate?: (parsed: unknown) => T | null;
  /**
   * After a keyring write, read it back and fall back to file if unreadable
   * (guards against keyrings where setPassword succeeds but getPassword
   * returns null in the same process).
   */
  verifySaveReadBack?: boolean;
}

export class KeyringStore<T> {
  private cached: T | null | undefined;
  private forceInsecure = false;
  private migrationAttempted = false;
  private fallbackWarningShown = false;

  constructor(private readonly opts: KeyringStoreOptions<T>) {}

  get filePath(): string {
    return path.join(os.homedir(), '.workos', this.opts.fileName);
  }

  setInsecure(value: boolean): void {
    this.forceInsecure = value;
    this.migrationAttempted = false;
    this.cached = undefined;
  }

  get insecure(): boolean {
    return this.forceInsecure;
  }

  /** Cached read: keyring first, then file (with one-shot keyring migration). */
  get(): T | null {
    if (this.cached !== undefined) return this.cached;

    if (this.forceInsecure) {
      this.cached = this.readFromFile();
      return this.cached;
    }

    const keyringValue = this.readFromKeyring();
    if (keyringValue) {
      this.cached = keyringValue;
      return keyringValue;
    }

    const fileValue = this.readFromFile();
    if (fileValue) {
      if (!this.migrationAttempted) {
        this.migrationAttempted = true;
        this.writeToKeyring(fileValue);
      }
      this.cached = fileValue;
      return fileValue;
    }

    this.cached = null;
    return null;
  }

  /**
   * Presence check without get()'s migration side effect. A keyring hit is
   * cached (get() would return it unchanged); a file-only hit is NOT cached
   * so get()'s migration still runs.
   */
  has(): boolean {
    if (this.cached !== undefined) return this.cached !== null;
    if (this.forceInsecure) return this.readFromFile() !== null;
    const keyringValue = this.readFromKeyring();
    if (keyringValue) {
      this.cached = keyringValue;
      return true;
    }
    return this.readFromFile() !== null;
  }

  save(value: T): void {
    if (this.forceInsecure) {
      this.writeToFile(value);
      this.cached = value;
      return;
    }

    if (!this.writeToKeyring(value)) {
      this.showFallbackWarning();
      this.writeToFile(value);
      this.cached = value;
      return;
    }

    if (this.opts.verifySaveReadBack && !this.readFromKeyring()) {
      logWarn('Keyring write succeeded but read-back failed — falling back to file');
      this.writeToFile(value);
    }
    this.cached = value;
  }

  clear(): void {
    this.deleteFromKeyring();
    this.deleteFile();
    this.migrationAttempted = false;
    this.cached = undefined;
  }

  /** Direct, uncached keyring read for diagnostics. Throws on backend errors. */
  readKeyringRaw(): string | null {
    return this.getKeyringEntry().getPassword();
  }

  private validate(parsed: unknown): T | null {
    return this.opts.validate ? this.opts.validate(parsed) : (parsed as T);
  }

  private getKeyringEntry(): KeyringEntryLike {
    if (process.platform === 'darwin') {
      return new DarwinSecurityEntry(this.opts.serviceName, this.opts.accountName);
    }
    return new Entry(this.opts.serviceName, this.opts.accountName);
  }

  private readFromKeyring(): T | null {
    const { serviceName, accountName, label } = this.opts;
    try {
      const data = this.getKeyringEntry().getPassword();
      if (!data) return null;
      const parsed: unknown = JSON.parse(data);
      const valid = this.validate(parsed);
      if (!valid) {
        logWarn(`[keyring-store] keyring: stored ${label} failed validation; treating as absent`);
      }
      return valid;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logWarn(`[keyring-store] ${label} keyring read failed: ${msg}`);
      observeHostFailure('keychain', error, {
        operation: 'read',
        target: `${serviceName}/${accountName}`,
        label: `${label} keychain entry`,
      });
      return null;
    }
  }

  private writeToKeyring(value: T): boolean {
    const { serviceName, accountName, label } = this.opts;
    try {
      this.getKeyringEntry().setPassword(JSON.stringify(value));
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logWarn(`[keyring-store] ${label} keyring write failed: ${msg}`);
      observeHostFailure('keychain', error, {
        operation: 'write',
        target: `${serviceName}/${accountName}`,
        label: `${label} keychain entry`,
      });
      return false;
    }
  }

  private deleteFromKeyring(): void {
    const { serviceName, accountName, label } = this.opts;
    try {
      this.getKeyringEntry().deletePassword();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('not found') && !msg.includes('No such')) {
        logWarn(`Failed to delete ${label} from keyring:`, error);
        observeHostFailure('keychain', error, {
          operation: 'delete',
          target: `${serviceName}/${accountName}`,
          label: `${label} keychain entry`,
        });
      }
    }
  }

  private readFromFile(): T | null {
    const filePath = this.filePath;
    if (!fs.existsSync(filePath)) return null;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(content);
      const valid = this.validate(parsed);
      if (!valid) {
        logWarn(`[keyring-store] file: stored ${this.opts.label} failed validation; treating as absent`);
      }
      return valid;
    } catch (error) {
      observeHostFailure('home-fs', error, {
        operation: 'read',
        target: filePath,
        label: `${this.opts.label} fallback file`,
      });
      logWarn(`Failed to read ${this.opts.label} file:`, error);
      return null;
    }
  }

  private writeToFile(value: T): void {
    const filePath = this.filePath;
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      fs.writeFileSync(filePath, JSON.stringify(value, null, 2), { mode: 0o600 });
    } catch (error) {
      observeHostFailure('home-fs', error, {
        operation: 'write',
        target: filePath,
        label: `${this.opts.label} fallback file`,
      });
      throw error;
    }
  }

  private deleteFile(): void {
    const filePath = this.filePath;
    if (!fs.existsSync(filePath)) return;
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      observeHostFailure('home-fs', error, {
        operation: 'delete',
        target: filePath,
        label: `${this.opts.label} fallback file`,
      });
      throw error;
    }
  }

  private showFallbackWarning(): void {
    if (this.fallbackWarningShown || this.forceInsecure) return;
    this.fallbackWarningShown = true;
    logWarn(
      `Unable to store ${this.opts.label} in system keyring. Using file storage.`,
      `Saved to ~/.workos/${this.opts.fileName}`,
      'Use --insecure-storage to suppress this warning.',
    );
  }
}

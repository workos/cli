/**
 * Pure-JS keyring module that shells out to OS credential managers.
 *
 * Drop-in replacement for @napi-rs/keyring's Entry class.
 * Uses execFileSync with array arguments (no shell interpolation) for safety.
 *
 * Backends:
 * - macOS: `security` (Keychain)
 * - Linux: `secret-tool` (Secret Service / libsecret)
 * - Windows: PowerShell (Credential Manager via DPAPI)
 */

import { execFileSync } from 'node:child_process';

const currentPlatform = process.platform;

const SILENT_STDIO = { stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'] };

// macOS Keychain returns exit code 44 when an item is not found
const MACOS_ITEM_NOT_FOUND = 44;

function isKeychainNotFound(error: unknown): boolean {
  return error instanceof Error && 'status' in error && (error as { status: number }).status === MACOS_ITEM_NOT_FOUND;
}

// ─── macOS (Keychain via `security` CLI) ──────────────────────────────────────

function macosGet(service: string, account: string): string | null {
  try {
    const result = execFileSync('security', [
      'find-generic-password',
      '-s', service,
      '-a', account,
      '-w',
    ], { encoding: 'utf-8', ...SILENT_STDIO });
    return result.trimEnd();
  } catch (error: unknown) {
    if (isKeychainNotFound(error)) return null;
    throw error;
  }
}

function macosSet(service: string, account: string, password: string): void {
  // -U flag updates if exists, creates if not
  execFileSync('security', [
    'add-generic-password',
    '-U',
    '-s', service,
    '-a', account,
    '-w', password,
  ], SILENT_STDIO);
}

function macosDelete(service: string, account: string): void {
  try {
    execFileSync('security', [
      'delete-generic-password',
      '-s', service,
      '-a', account,
    ], SILENT_STDIO);
  } catch (error: unknown) {
    if (isKeychainNotFound(error)) return;
    throw error;
  }
}

// ─── Linux (Secret Service via `secret-tool` CLI) ─────────────────────────────

function linuxGet(service: string, account: string): string | null {
  try {
    const result = execFileSync('secret-tool', [
      'lookup',
      'service', service,
      'account', account,
    ], { encoding: 'utf-8', ...SILENT_STDIO });
    const trimmed = result.trimEnd();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function linuxSet(service: string, account: string, password: string): void {
  // Password is passed via stdin to avoid leaking in process list
  execFileSync('secret-tool', [
    'store',
    '--label=' + service,
    'service', service,
    'account', account,
  ], { input: password, ...SILENT_STDIO });
}

function linuxDelete(service: string, account: string): void {
  try {
    execFileSync('secret-tool', [
      'clear',
      'service', service,
      'account', account,
    ], SILENT_STDIO);
  } catch {
    // Silently succeed if entry doesn't exist
  }
}

// ─── Windows (Credential Manager via PowerShell) ──────────────────────────────

function windowsTargetName(service: string, account: string): string {
  return `${service}:${account}`;
}

function escapePS(s: string): string {
  return s.replace(/'/g, "''");
}

// Shared C# P/Invoke definitions for Windows Credential Manager
const WIN_CRED_CSHARP = `
    using System;
    using System.Runtime.InteropServices;
    using System.Text;
    public class CredNative {
      [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
      public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
      [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
      public static extern bool CredWrite(ref CREDENTIAL cred, int flags);
      [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
      public static extern bool CredDelete(string target, int type, int flags);
      [DllImport("advapi32.dll")]
      public static extern void CredFree(IntPtr cred);
      [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
      public struct CREDENTIAL {
        public int Flags; public int Type; public string TargetName;
        public string Comment; public long LastWritten; public int CredentialBlobSize;
        public IntPtr CredentialBlob; public int Persist; public int AttributeCount;
        public IntPtr Attributes; public string TargetAlias; public string UserName;
      }
      public static string Read(string target) {
        IntPtr ptr;
        if (!CredRead(target, 1, 0, out ptr)) return null;
        try {
          CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
          return Marshal.PtrToStringUni(cred.CredentialBlob, cred.CredentialBlobSize / 2);
        } finally { CredFree(ptr); }
      }
      public static void Write(string target, string user, string pass) {
        byte[] bytes = Encoding.Unicode.GetBytes(pass);
        CREDENTIAL cred = new CREDENTIAL();
        cred.Type = 1; cred.TargetName = target; cred.UserName = user;
        cred.CredentialBlobSize = bytes.Length; cred.Persist = 2;
        cred.CredentialBlob = Marshal.AllocHGlobal(bytes.Length);
        try {
          Marshal.Copy(bytes, 0, cred.CredentialBlob, bytes.Length);
          if (!CredWrite(ref cred, 0)) throw new Exception("CredWrite failed");
        } finally { Marshal.FreeHGlobal(cred.CredentialBlob); }
      }
      public static void Delete(string target) {
        CredDelete(target, 1, 0);
      }
    }
`;

function runWindowsCredScript(script: string, opts?: { input?: string; encoding?: BufferEncoding }): string {
  const full = `
    $ErrorActionPreference = 'Stop'
    Add-Type -TypeDefinition @'${WIN_CRED_CSHARP}'@
    ${script}
  `;
  return execFileSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command', full,
  ], { ...SILENT_STDIO, ...opts }) as unknown as string;
}

function windowsGet(service: string, account: string): string | null {
  const target = windowsTargetName(service, account);
  try {
    const result = runWindowsCredScript(
      `$r = [CredNative]::Read('${escapePS(target)}')
    if ($r -eq $null) { exit 1 }
    [Console]::Out.Write($r)`,
      { encoding: 'utf-8' },
    );
    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

function windowsSet(service: string, account: string, password: string): void {
  const target = windowsTargetName(service, account);
  runWindowsCredScript(
    `[CredNative]::Write('${escapePS(target)}', '${escapePS(account)}', $input)`,
    { input: password },
  );
}

function windowsDelete(service: string, account: string): void {
  const target = windowsTargetName(service, account);
  try {
    runWindowsCredScript(`[CredNative]::Delete('${escapePS(target)}')`);
  } catch {
    // Silently succeed if entry doesn't exist
  }
}

// ─── Entry class (drop-in replacement for @napi-rs/keyring Entry) ─────────────

export class Entry {
  constructor(
    private service: string,
    private account: string,
  ) {}

  getPassword(): string | null {
    switch (currentPlatform) {
      case 'darwin':
        return macosGet(this.service, this.account);
      case 'linux':
        return linuxGet(this.service, this.account);
      case 'win32':
        return windowsGet(this.service, this.account);
      default:
        throw new Error(`Unsupported platform for keyring: ${currentPlatform}`);
    }
  }

  setPassword(password: string): void {
    switch (currentPlatform) {
      case 'darwin':
        return macosSet(this.service, this.account, password);
      case 'linux':
        return linuxSet(this.service, this.account, password);
      case 'win32':
        return windowsSet(this.service, this.account, password);
      default:
        throw new Error(`Unsupported platform for keyring: ${currentPlatform}`);
    }
  }

  deletePassword(): void {
    switch (currentPlatform) {
      case 'darwin':
        return macosDelete(this.service, this.account);
      case 'linux':
        return linuxDelete(this.service, this.account);
      case 'win32':
        return windowsDelete(this.service, this.account);
      default:
        throw new Error(`Unsupported platform for keyring: ${currentPlatform}`);
    }
  }
}

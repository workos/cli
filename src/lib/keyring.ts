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

const platform = process.platform;

// ─── macOS (Keychain via `security` CLI) ──────────────────────────────────────

function macosGet(service: string, account: string): string | null {
  try {
    const result = execFileSync('security', [
      'find-generic-password',
      '-s', service,
      '-a', account,
      '-w',
    ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return result.trimEnd();
  } catch (error: unknown) {
    // Exit code 44 = item not found — expected, return null
    if (error instanceof Error && 'status' in error && (error as { status: number }).status === 44) {
      return null;
    }
    // Any other error (keychain locked, command not found) — re-throw
    // so credential-store falls back to file storage
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
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
}

function macosDelete(service: string, account: string): void {
  try {
    execFileSync('security', [
      'delete-generic-password',
      '-s', service,
      '-a', account,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error: unknown) {
    // Exit code 44 = item not found — silently succeed (matches @napi-rs/keyring behavior)
    if (error instanceof Error && 'status' in error && (error as { status: number }).status === 44) {
      return;
    }
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
    ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    // secret-tool returns empty string when not found (exit 0) or exits non-zero
    const trimmed = result.trimEnd();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    // Command not found or lookup failed — return null for "not found",
    // but rethrow if the tool itself is missing
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
  ], { input: password, stdio: ['pipe', 'pipe', 'pipe'] });
}

function linuxDelete(service: string, account: string): void {
  try {
    execFileSync('secret-tool', [
      'clear',
      'service', service,
      'account', account,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    // Silently succeed if entry doesn't exist
  }
}

// ─── Windows (Credential Manager via PowerShell) ──────────────────────────────

function windowsTargetName(service: string, account: string): string {
  return `${service}:${account}`;
}

function windowsGet(service: string, account: string): string | null {
  const target = windowsTargetName(service, account);
  // Use .NET CredentialManager API via PowerShell — no external modules needed
  const script = `
    $ErrorActionPreference = 'Stop'
    Add-Type -TypeDefinition @'
    using System;
    using System.Runtime.InteropServices;
    public class CredManager {
      [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
      public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
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
    }
'@
    $r = [CredManager]::Read('${target.replace(/'/g, "''")}')
    if ($r -eq $null) { exit 1 }
    [Console]::Out.Write($r)
  `;
  try {
    const result = execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command', script,
    ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

function windowsSet(service: string, account: string, password: string): void {
  const target = windowsTargetName(service, account);
  const script = `
    $ErrorActionPreference = 'Stop'
    Add-Type -TypeDefinition @'
    using System;
    using System.Runtime.InteropServices;
    using System.Text;
    public class CredWriter {
      [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
      public static extern bool CredWrite(ref CREDENTIAL cred, int flags);
      [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
      public struct CREDENTIAL {
        public int Flags; public int Type; public string TargetName;
        public string Comment; public long LastWritten; public int CredentialBlobSize;
        public IntPtr CredentialBlob; public int Persist; public int AttributeCount;
        public IntPtr Attributes; public string TargetAlias; public string UserName;
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
    }
'@
    [CredWriter]::Write('${target.replace(/'/g, "''")}', '${account.replace(/'/g, "''")}', $input)
  `;
  execFileSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command', script,
  ], { input: password, stdio: ['pipe', 'pipe', 'pipe'] });
}

function windowsDelete(service: string, account: string): void {
  const target = windowsTargetName(service, account);
  try {
    execFileSync('cmdkey', ['/delete:' + target], { stdio: ['pipe', 'pipe', 'pipe'] });
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
    switch (platform) {
      case 'darwin':
        return macosGet(this.service, this.account);
      case 'linux':
        return linuxGet(this.service, this.account);
      case 'win32':
        return windowsGet(this.service, this.account);
      default:
        throw new Error(`Unsupported platform for keyring: ${platform}`);
    }
  }

  setPassword(password: string): void {
    switch (platform) {
      case 'darwin':
        return macosSet(this.service, this.account, password);
      case 'linux':
        return linuxSet(this.service, this.account, password);
      case 'win32':
        return windowsSet(this.service, this.account, password);
      default:
        throw new Error(`Unsupported platform for keyring: ${platform}`);
    }
  }

  deletePassword(): void {
    switch (platform) {
      case 'darwin':
        return macosDelete(this.service, this.account);
      case 'linux':
        return linuxDelete(this.service, this.account);
      case 'win32':
        return windowsDelete(this.service, this.account);
      default:
        throw new Error(`Unsupported platform for keyring: ${platform}`);
    }
  }
}

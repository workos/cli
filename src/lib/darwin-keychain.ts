/**
 * macOS credential storage via /usr/bin/security instead of the native
 * keyring binding.
 *
 * Why: keychain item ACLs pin trust to the requesting binary's code
 * signature. The shipped CLI is a Bun-compiled, ad-hoc-signed binary whose
 * signature changes every release, so reads through the native binding
 * trigger a password prompt per version (and per read). /usr/bin/security is
 * Apple-signed and stable, so items it creates read back silently forever.
 *
 * Accepted trade-off until releases are Developer ID signed: any user-level
 * process can read the item silently through the same tool, so app-level
 * isolation is lost — comparable to the existing file fallback's protection.
 * ponytail: interim until Developer ID signing lands, then revert darwin to
 * @napi-rs/keyring to regain app-level isolation.
 */
import { spawnSync } from 'node:child_process';

const SECURITY = '/usr/bin/security';
const NOT_FOUND_EXIT = 44; // errSecItemNotFound

/** Same surface as @napi-rs/keyring's Entry, backed by /usr/bin/security. */
export class DarwinSecurityEntry {
  constructor(
    private readonly service: string,
    private readonly account: string,
  ) {
    // service/account are interpolated into a `security -i` command line
    // (double-quoted). Current callers pass module constants; reject anything
    // that could break the interactive parser if a future caller doesn't.
    for (const v of [service, account]) {
      if (!/^[\w.-]+$/.test(v)) {
        throw new Error(`invalid keychain service/account: ${JSON.stringify(v)}`);
      }
    }
  }

  getPassword(): string | null {
    const r = spawnSync(SECURITY, ['find-generic-password', '-s', this.service, '-a', this.account, '-w'], {
      encoding: 'utf-8',
    });
    if (r.status === NOT_FOUND_EXIT) return null;
    if (r.status !== 0) {
      throw new Error(`security find-generic-password exited ${r.status}: ${(r.stderr ?? '').trim()}`);
    }
    const raw = r.stdout.replace(/\n$/, '');
    // Items written by this class hold base64; items left behind by the
    // native binding hold raw JSON (read of those may prompt once — their
    // ACL still pins the old binary — until the next save re-mints the item).
    if (raw.startsWith('{')) return raw;
    return Buffer.from(raw, 'base64').toString('utf-8');
  }

  setPassword(password: string): void {
    // Delete-then-add rather than update in place: updating keeps the old
    // item's ACL (pinned to a previous binary). A fresh item is owned by
    // /usr/bin/security and reads back without prompting.
    this.deletePassword();
    const b64 = Buffer.from(password, 'utf-8').toString('base64');
    // -i reads commands from stdin so the secret never appears in argv,
    // where it would be visible to `ps`.
    const r = spawnSync(SECURITY, ['-i'], {
      input: `add-generic-password -a "${this.account}" -s "${this.service}" -w "${b64}"\n`,
      encoding: 'utf-8',
    });
    if (r.status !== 0) {
      throw new Error(`security add-generic-password exited ${r.status}: ${(r.stderr ?? '').trim()}`);
    }
  }

  deletePassword(): void {
    const r = spawnSync(SECURITY, ['delete-generic-password', '-s', this.service, '-a', this.account], {
      encoding: 'utf-8',
    });
    if (r.status === 0 || r.status === NOT_FOUND_EXIT) return;
    throw new Error(`security delete-generic-password exited ${r.status}: ${(r.stderr ?? '').trim()}`);
  }
}

// Detects how this CLI binary was installed so the "update available" notice
// can suggest the matching upgrade command instead of a one-size-fits-all
// GitHub link. The only runtime signal is process.execPath — for a Bun
// standalone binary that is the path to the compiled executable itself (not a
// runtime + script), which is exactly the file a package manager laid down.
export type InstallMethod = 'homebrew' | 'npm' | 'download';

const RELEASES_URL = 'https://github.com/workos/cli/releases/latest';

/**
 * Infer the install channel from the running binary's path.
 *
 * - `homebrew`: Homebrew stages every formula under a versioned Cellar dir and
 *   symlinks it onto PATH. execPath resolves to the real Cellar path on macOS
 *   (`/opt/homebrew`, `/usr/local`) and Linuxbrew (`/home/linuxbrew/.linuxbrew`);
 *   the prefix checks also catch an unresolved `/opt/homebrew/bin` symlink.
 * - `npm`: the npm launcher spawns the platform package's binary, which lives
 *   under `node_modules/@workos/cli-<platform>/bin/workos`.
 * - `download`: a binary pulled straight from GitHub Releases onto PATH.
 *
 * @param execPath overridable for testing; defaults to the running binary.
 */
export function detectInstallMethod(execPath: string = process.execPath): InstallMethod {
  // Normalize Windows separators first: the npm launcher's binary lives at
  // …\npm\node_modules\@workos\cli-win32-x64\bin\workos.exe, which the
  // POSIX-style markers below would otherwise miss.
  const path = execPath.replaceAll('\\', '/');
  if (path.includes('/Cellar/') || path.includes('/opt/homebrew/') || path.includes('/.linuxbrew/')) {
    return 'homebrew';
  }
  if (path.includes('/node_modules/')) {
    return 'npm';
  }
  return 'download';
}

/**
 * The upgrade line shown under an "Update available" notice, matched to how the
 * running binary was installed.
 */
export function upgradeNotice(method: InstallMethod = detectInstallMethod()): string {
  switch (method) {
    case 'homebrew':
      return 'Upgrade: brew upgrade workos';
    case 'npm':
      return 'Upgrade: npm install -g workos@latest';
    case 'download':
      return `Download: ${RELEASES_URL}`;
  }
}
